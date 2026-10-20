---
id: fix-loop-off-by-one
type: fix_the_code
title: Off-by-one in a while loop
topics: [Python Basics, Loops]
difficulty: easy
glossary: [while-loop, loop]
notebook: acc525/Intro to Python/Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb
---

This Markdown file **is** an exercise — it lives in `problems/` next to the JSON files and is
read by `python3 tools/build_index.py`.

The loop below should print the numbers `1 2 3` and then `done`. Right now it runs forever and
never prints `done`. Fix the loop so it stops after 3.

Expected output:

```
1
2
3
done
```

## hints
- `while counter < 3` stops as soon as the condition becomes false.
- Where is `counter` increased, and does it grow fast enough to ever reach 3?
- Keep the `print(counter)` before the `counter += 1`, so the values printed are 1, 2, 3.

## starter_code
```python
counter = 0

while counter <= 3:
    print(counter)

print("done")
```

Note that the starter never changes `counter` — the loop can never end. The automatic runner
stops it after a moment instead of freezing your browser.

## expected_output
1
2
3
done

## tests
```python
assert counter == 3, "the loop should end with counter == 3"
```

## solution
```python
counter = 0

while counter < 3:
    counter += 1
    print(counter)

print("done")
```
