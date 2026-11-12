#!/usr/bin/env python3
"""pixel-agents-secure (local): draws the lounge's furniture of ours: the coffee
corner (a coffee machine on its counter, a neon "COFFEE" sign for the wall) and
the game corner (a pouf, a TV with a video game on its cabinet), in
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


def pouf():
    """16x16: a bean bag seen from above and a little from the front."""
    colors = {'o': '#1d5550', 'b': '#3fb6a8', 'l': '#7fe0d2', 's': '#2b8a80'}
    rows = [
        '................',
        '................',
        '.....oooooo.....',
        '...oobbbbbboo...',
        '..obbllllbbbbo..',
        '..obllbbbbbbbo..',
        '.obblbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbbbo.',
        '.obbbbbbbbbbsbo.',
        '..obbbbbbbbsso..',
        '..oobbbbbssoo...',
        '....oooooooo....',
        '................',
        '................',
        '................',
    ]
    return from_text(rows, colors, (16, 16))


def video_game():
    """32x32: a TV showing a platform game, on a cabinet with the console and two
    controllers. The TV is the upper tile, behind whoever walks past."""
    img = Image.new('RGBA', (32, 32))

    def rect(x0, y0, x1, y1, colour):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                img.putpixel((x, y), rgba(colour))

    rect(2, 2, 29, 17, '#1c1c22')      # the TV's frame
    rect(4, 4, 27, 11, '#4aa8ff')      # sky
    rect(4, 12, 27, 15, '#3fa34d')     # ground
    rect(4, 12, 27, 12, '#6fd67c')
    rect(22, 5, 25, 6, '#ffffff')      # a cloud
    rect(9, 9, 10, 11, '#e5484d')      # the hero
    rect(9, 8, 10, 8, '#f6c9a0')
    rect(16, 7, 16, 7, '#ffd84a')      # coins
    rect(20, 6, 20, 6, '#ffd84a')
    rect(14, 10, 18, 11, '#b5651d')    # a block
    rect(14, 18, 17, 19, '#1c1c22')    # the TV's foot
    rect(1, 20, 30, 30, '#2b2320')     # the cabinet
    rect(2, 21, 29, 29, '#8a5a34')
    rect(2, 21, 29, 21, '#b07a4a')
    rect(5, 23, 11, 26, '#aab4c0')     # the console
    rect(5, 26, 11, 26, '#7f8fa3')
    rect(10, 24, 10, 24, '#5dff7a')
    rect(16, 25, 19, 26, '#23262d')    # two controllers
    rect(22, 25, 25, 26, '#23262d')
    rect(17, 25, 17, 25, '#e5484d')
    rect(24, 25, 24, 25, '#4aa8ff')
    return img


def main():
    drawn = {
        os.path.join('COFFEE_MACHINE', 'COFFEE_MACHINE.png'): machine(),
        os.path.join('NEON_COFFEE', 'NEON_COFFEE.png'): neon(),
        os.path.join('POUF', 'POUF.png'): pouf(),
        os.path.join('VIDEO_GAME', 'VIDEO_GAME.png'): video_game(),
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
