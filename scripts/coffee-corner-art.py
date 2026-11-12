#!/usr/bin/env python3
"""pixel-agents-secure (local): draws the coffee corner's furniture, a coffee
machine on its counter and a neon "COFFEE" sign for the wall, in
webview-ui/public/assets/furniture/. The PNGs are committed; this script is how
they were made, and how to change them:

    python3 -I scripts/coffee-corner-art.py            # rewrite the PNGs
    python3 -I scripts/coffee-corner-art.py --check    # fail if a PNG differs from what this draws

Needs Pillow.
"""
import os
import sys

from PIL import Image

FURNITURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'webview-ui', 'public', 'assets', 'furniture'
)


def rgba(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def from_text(rows, colors, size):
    img = Image.new('RGBA', size)
    for y, line in enumerate(rows):
        assert len(line) == size[0], (y, line)
        for x, ch in enumerate(line):
            if ch != '.':
                img.putpixel((x, y), rgba(colors[ch]))
    return img


def machine():
    """16x32: the machine (a cup under its spout) on a wooden counter."""
    colors = {
        'o': '#2b2320', 'r': '#c8402f', 'R': '#e8604a', 'd': '#3a3f4a', 'g': '#5dff7a',
        'l': '#9fe8ff', 's': '#aab4c0', 'k': '#15171c', 'w': '#ffffff', 'b': '#8a5a34',
        'h': '#b07a4a',
    }
    # Drawn high in its two tiles: standing against a wall, its body is over
    # the wall and its counter ends a little past the wall's foot.
    rows = ['................'] * 3 + [
        '..oooooooooooo..',
        '..oRRRRRRRRRRo..',
        '..orrrrrrrrrro..',
        '..oddddddddddo..',
        '..odgddddllldo..',
        '..oddddddddddo..',
        '..ossskkkkssso..',
        '..osskwwwwksso..',
        '..osskwwwwksso..',
        '..osskkkkkksso..',
        '..oooooooooooo..',
        '.oooooooooooooo.',
        '.ohhhhhhhhhhhho.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbobbbbbbo.',
        '.obbbbbobbbbbbo.',
        '.obbbbhobhbbbbo.',
        '.obbbbbobbbbbbo.',
        '.obbbbbobbbbbbo.',
        '.obbbbbobbbbbbo.',
        '.obbbbbobbbbbbo.',
        '.oooooooooooooo.',
    ] + ['................'] * 7
    return from_text(rows, colors, (16, 32))


FONT = {
    'C': ['###', '#..', '#..', '#..', '###'],
    'O': ['###', '#.#', '#.#', '#.#', '###'],
    'F': ['###', '#..', '##.', '#..', '#..'],
    'E': ['###', '#..', '##.', '#..', '###'],
}


def neon():
    """32x32, drawn where a whiteboard is (rows 8-23): COFFEE in pink over a cyan
    line and cup, on a dark board."""
    board, edge, pink, cyan = '#16122a', '#3b2f6b', '#ff5fd2', '#5ff3ff'
    img = Image.new('RGBA', (32, 32))
    for y in range(8, 24):
        for x in range(2, 30):
            rim = x in (2, 29) or y in (8, 23)
            img.putpixel((x, y), rgba(edge if rim else board))
    x = 5
    for letter in 'COFFEE':
        for dy, line in enumerate(FONT[letter]):
            for dx, ch in enumerate(line):
                if ch == '#':
                    img.putpixel((x + dx, 10 + dy), rgba(pink))
        x += 4
    for x in range(5, 28):
        img.putpixel((x, 16), rgba(cyan))
    cup = ['.#.#..', '......', '#####.', '#####+', '.###..']
    for dy, line in enumerate(cup):
        for dx, ch in enumerate(line):
            if ch != '.':
                img.putpixel((13 + dx, 17 + dy), rgba(pink if dy == 0 else cyan))
    return img


def main():
    drawn = {
        os.path.join('COFFEE_MACHINE', 'COFFEE_MACHINE.png'): machine(),
        os.path.join('NEON_COFFEE', 'NEON_COFFEE.png'): neon(),
    }
    bad = []
    for rel, img in drawn.items():
        path = os.path.join(FURNITURE, rel)
        if '--check' in sys.argv:
            if not os.path.exists(path) or list(Image.open(path).convert('RGBA').getdata()) != list(img.getdata()):
                bad.append(rel)
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            img.save(path, optimize=True)
    if bad:
        sys.exit('coffee corner art differs from coffee-corner-art.py: ' + ', '.join(bad))


if __name__ == '__main__':
    main()
