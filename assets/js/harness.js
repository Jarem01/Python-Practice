/**
 * The Python side of the runner.
 *
 * Everything (stdout/stderr capture, input(), error formatting and the
 * runaway-loop guard) happens inside Python. That keeps behavior identical in
 * the browser, in Node tests and in any other embedding, and avoids surprises
 * with Pyodide's JS-side stream redirects.
 *
 * `__fb_exec(spec)` takes a JSON string and returns a JSON string:
 *   spec  = { code, tests, setup, stdin, lineLimit, captureLast, files }
 *   reply = { ok, stdout, stderr, setup_stdout, error: {type,message,line,source,where,traceback}|null, steps }
 */

export const HARNESS_SOURCE = String.raw`
import io, json, sys, traceback, contextlib

__FB_FILE = "<your code>"
__FB_TESTS = "<tests>"
__FB_SETUP = "<setup>"


def __fb_clean_traceback(exc):
    """Drop the harness frames so the learner only sees their own code."""
    lines = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).splitlines()
    kept = []
    skipping = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('File "'):
            skipping = '"<harness>"' in stripped
            if not skipping:
                kept.append(line)
            continue
        if skipping:
            continue
        kept.append(line)
    return "\n".join(kept)


def __fb_prepare_files(files):
    """Materialize data files (CSV, XLSX, ...) so notebook code can read them.

    A value may be a string (written as UTF-8 text) or {"base64": ...} for
    binary formats such as .xlsx.
    """
    import base64
    import os
    for name, content in (files or {}).items():
        directory = os.path.dirname(name)
        if directory:
            os.makedirs(directory, exist_ok=True)
        if isinstance(content, dict) and "base64" in content:
            with open(name, "wb") as handle:
                handle.write(base64.b64decode(content["base64"]))
        else:
            with open(name, "w", encoding="utf-8") as handle:
                handle.write(str(content))


def __fb_compile(code, capture_last):
    """Compile user code, optionally displaying a trailing expression the way a
    Jupyter cell does, so data.head() and print(data.head()) grade the same."""
    if not capture_last:
        return compile(code, __FB_FILE, "exec")

    import ast

    tree = ast.parse(code, __FB_FILE, "exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        node = tree.body.pop()
        name = "__fb_display_value__"
        assignment = ast.Assign(
            targets=[ast.Name(id=name, ctx=ast.Store())], value=node.value
        )
        ast.copy_location(assignment, node)
        test = ast.Compare(
            left=ast.Name(id=name, ctx=ast.Load()),
            ops=[ast.IsNot()],
            comparators=[ast.Constant(value=None)],
        )
        ast.copy_location(test, node)
        show = ast.Expr(
            value=ast.Call(
                func=ast.Name(id="print", ctx=ast.Load()),
                args=[ast.Name(id=name, ctx=ast.Load())],
                keywords=[],
            )
        )
        ast.copy_location(show, node)
        tree.body.append(assignment)
        tree.body.append(ast.If(test=test, body=[show], orelse=[]))
        ast.fix_missing_locations(tree)
    return compile(tree, __FB_FILE, "exec")


def __fb_exec(spec):
    if isinstance(spec, str):
        spec = json.loads(spec)
    user_code = spec.get("code") or ""
    capture_last = bool(spec.get("captureLast"))
    test_code = spec.get("tests") or ""
    setup_code = spec.get("setup") or ""
    stdin_text = spec.get("stdin") or ""
    line_limit = int(spec.get("lineLimit") or 2000000)

    out = io.StringIO()
    err = io.StringIO()
    namespace = {"__name__": "__main__", "__file__": __FB_FILE}

    inputs = list(stdin_text.splitlines())
    cursor = {"pos": 0}

    def _input(prompt=""):
        if prompt:
            out.write(str(prompt))
        if cursor["pos"] >= len(inputs):
            raise EOFError("input() was called but no input was provided")
        value = inputs[cursor["pos"]]
        cursor["pos"] += 1
        return value

    namespace["input"] = _input

    counter = {"steps": 0, "tripped": False}
    counted_files = (__FB_FILE, __FB_TESTS, __FB_SETUP)

    def _tracer(frame, event, arg):
        # Only count lines that belong to the learner's own code. Importing numpy
        # or pandas runs hundreds of thousands of library lines, which must not
        # be mistaken for a runaway loop.
        if frame.f_code.co_filename not in counted_files:
            return None
        counter["steps"] += 1
        if counter["steps"] > line_limit:
            counter["tripped"] = True
            sys.settrace(None)
            raise RuntimeError(
                "Stopped after %d steps in your code - that looks like an infinite loop. "
                "Check your loop condition." % line_limit
            )
        return _tracer

    def _drop_partial_imports():
        """An interrupted import leaves a half-built module in sys.modules,
        which breaks every later import of it. Clean those up."""
        for name, module in list(sys.modules.items()):
            spec = getattr(module, "__spec__", None)
            if spec is not None and getattr(spec, "_initializing", False):
                sys.modules.pop(name, None)

    result = {"ok": False, "stdout": "", "stderr": "", "error": None, "steps": 0}
    # Setup is the notebook's earlier code: it must run, but what it prints is not
    # the learner's output, so it is captured separately instead of leaking into
    # stdout (or into the console).
    setup_out = io.StringIO()

    try:
        __fb_prepare_files(spec.get("files"))
        if setup_code:
            with contextlib.redirect_stdout(setup_out), contextlib.redirect_stderr(setup_out):
                exec(compile(setup_code, __FB_SETUP, "exec"), namespace)
        sys.settrace(_tracer)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(__fb_compile(user_code, capture_last), namespace)
            if test_code:
                exec(compile(test_code, __FB_TESTS, "exec"), namespace)
        result["ok"] = True
    except BaseException as exc:
        frames = traceback.extract_tb(exc.__traceback__) if exc.__traceback__ else []
        relevant = [f for f in frames if f.filename in (__FB_FILE, __FB_TESTS, __FB_SETUP)]
        frame = relevant[-1] if relevant else (frames[-1] if frames else None)
        where = "user"
        if frame is not None:
            if frame.filename == __FB_TESTS:
                where = "tests"
            elif frame.filename == __FB_SETUP:
                where = "setup"
        result["error"] = {
            "type": type(exc).__name__,
            "message": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
            "line": frame.lineno if frame is not None else None,
            "source": (frame.line or "") if frame is not None else "",
            "where": where,
            "traceback": __fb_clean_traceback(exc),
        }
    finally:
        sys.settrace(None)
        result["steps"] = counter["steps"]
        if counter["tripped"]:
            try:
                _drop_partial_imports()
            except Exception:
                pass

    result["stdout"] = out.getvalue()
    result["stderr"] = err.getvalue()
    result["setup_stdout"] = setup_out.getvalue()
    return json.dumps(result)
`;
