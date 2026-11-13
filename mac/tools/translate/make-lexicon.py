#!/usr/bin/env python3
"""Builds the two word lists PS's Latin Georgian reader uses (translate/ka-words.txt.gz, translate/en-words.txt.gz).
They ship inside PS (small, like geo/ip-country.bin); the translation model does not.

Georgian: word counts from the Leipzig Corpora Collection (https://wortschatz.uni-leipzig.de, CC BY 4.0):
kat-ge_web_2019_1M (weighted x3, closest to SMS and chat), kat_newscrawl_2016_300K, kat_wikipedia_2021_300K.
English (only to tell English words apart from Latin Georgian ones): FrequencyWords en_50k (Hermit Dave,
OpenSubtitles 2018, CC BY-SA 4.0), commit 525f9b5.

Kept: the 300,000 most frequent Georgian forms. Format (UTF-8, gzip): one word a line, sorted, each led by one character: chr(33 + b), where the word
was seen about 2^(b/2) times.
Usage: make-lexicon.py <folder with the three *-words.txt folders and en_50k.txt> <out folder>
"""
import collections, glob, gzip, math, os, re, sys

src, out = sys.argv[1], sys.argv[2]
geo = re.compile(r'^[ა-ჰ]+$')
c = collections.Counter()
for f in sorted(glob.glob(os.path.join(src, '*', '*-words.txt'))):
    w = 3 if 'web' in os.path.basename(f) else 1
    for line in open(f, encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) >= 3 and geo.match(p[1]):
            c[p[1]] += w * int(p[2])

def write(path, items):
    # Sorted by word (code point order, the same order JavaScript sorts Georgian in), so PS loads it without sorting.
    lines = [chr(33 + min(90, int(round(2 * math.log2(n))))) + word for word, n in sorted(items)]
    with gzip.GzipFile(path, 'wb', mtime=0) as g:
        g.write(('\n'.join(lines) + '\n').encode('utf-8'))
    print(path, len(items), 'words', os.path.getsize(path), 'bytes')

write(os.path.join(out, 'ka-words.txt.gz'), [(w, n) for w, n in c.most_common(300000) if n >= 3])
en = []
for line in open(os.path.join(src, 'en_50k.txt'), encoding='utf-8'):
    p = line.split()
    if len(p) == 2 and re.match(r"^[a-z]+$", p[0]):
        en.append((p[0], int(p[1])))
write(os.path.join(out, 'en-words.txt.gz'), en[:40000])
