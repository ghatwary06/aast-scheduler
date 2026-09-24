#!/usr/bin/env python3
"""Copy the first fenced code block after a heading/marker line in a plan into a file.

Usage: extract-plan-block.py PLAN "MARKER" OUT
"""
import re
import sys

plan, marker, out = sys.argv[1:4]
s = open(plan).read()
i = s.index(marker)
m = re.compile(r"^```[a-z]*\n", re.M).search(s, i)
j = m.end()
k = s.index("\n```", j)
open(out, "w").write(s[j:k] + "\n")
