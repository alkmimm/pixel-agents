#!/usr/bin/env python3
"""pixel-agents-secure (local): draws the model gear sheets (sword, armour, helm,
shield, gem) in webview-ui/src/characters/art/gear/. The PNGs are committed;
this script is how they were made, and how to change them:

    python3 -I scripts/gear-art.py            # rewrite the PNGs
    python3 -I scripts/gear-art.py --check    # fail if a PNG differs from what this draws

One 128x96 sheet per tier (8 frames x 3 rows of 16x32: front, back, right),
laid over the finished character (characters/renderer.ts). The armour is the
t-shirt's own art in metal tones, so it follows the arms in every frame; the
rest is stamped at each frame's head position, read from the body's art.
Needs Pillow.
"""
import os
import sys

from PIL import Image

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webview-ui', 'src', 'characters', 'art')
FW, FH, FRAMES, ROWS = 16, 32, 8, 3
FRONT, BACK, SIDE = 0, 1, 2
TYPE1, TYPE2, SEATED = 3, 4, 7

# Metal ramps: outline, shade, base, light.
STEEL = ['#2b3440', '#7f8fa3', '#a3b4c8', '#e6eef6']
GOLD = ['#6b4a12', '#c8962a', '#e8bb3e', '#fff2a8']
LEATHER = ['#3b2414', '#7a4a22', '#93602f', '#c08a4a']
WOOD, RED, WHITE = '#c9965a', '#d23a3a', '#ffffff'


def rgba(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def head_tops(body):
    """Each frame's first opaque row: where the head starts."""
    tops = []
    for r in range(ROWS):
        row = []
        for f in range(FRAMES):
            box = body.crop((f * FW, r * FH, (f + 1) * FW, (r + 1) * FH)).getbbox()
            row.append(box[1])
        tops.append(row)
    return tops


def armour(shirt, ramp):
    """The t-shirt in a metal ramp, its tones darkest to lightest."""
    tones = sorted({p[:3] for p in shirt.getdata() if p[3] > 0}, key=sum)
    to = {t: rgba(ramp[min(i, len(ramp) - 1)]) for i, t in enumerate(tones)}
    out = Image.new('RGBA', shirt.size)
    out.putdata([to[p[:3]] if p[3] > 0 else (0, 0, 0, 0) for p in shirt.getdata()])
    return out


# Pieces as text, one per view, placed for a head starting at row 2 (front and
# back) or 5 (side): '.' is nothing, other letters index the piece's colours.
def helm(ramp, plume):
    o, s, b, l = ramp
    return {
        'colors': {'o': o, 's': s, 'b': b, 'l': l, 'p': plume or b, 'P': plume or o},
        FRONT: (2, 0, [
            '....PppP....',
            '..oooppooo..',
            '.osbbbbbbbo.',
            'osblbbbbbbso',
            'osllbbbbbbso',
            'osbbbbbbbbso',
            'osbbbbbbbbso',
            'oossssssssoo',
            'os........so',
            'os........so',
            'os........so',
            'oo........oo',
        ]),
        BACK: (2, 0, [
            '....PppP....',
            '..oooppooo..',
            '.osbbbbbbbo.',
            'osbbbbbblbso',
            'osbbbbbbllso',
            'osbbbbbbbbso',
            'osbbbbbbbbso',
            'osbbbbbbbbso',
            'osbbbbbbbbso',
            'ossbbbbbbsso',
            'oossssssssoo',
            '.oooooooooo.',
        ]),
        SIDE: (2, 3, [
            '...PppP.....',
            '..ooppooo...',
            '.osbbbbbbo..',
            'osbbbbblbbo.',
            'osbbbbbllbso',
            'osbbbbbbbbso',
            'osbbbbbbbbso',
            'osbbbsssssoo',
            'osbbso......',
            'osbso.......',
            'osso........',
            'ooo.........',
        ]),
    }


def sword(hilt):
    return {
        'colors': {'o': STEEL[0], 'b': STEEL[2], 'l': STEEL[3], 'g': hilt, 'w': WOOD},
        # Across the back: from the front, the hilt over one shoulder and the
        # tip by the other hip.
        FRONT: [
            (11, 9, [
                '...og',
                '..owo',
                '.owo.',
                'ogo..',
                'gggo.',
                '.og..',
            ]),
            (0, 21, [
                '..o',
                '.lo',
                'lbo',
                'bo.',
                'o..',
            ]),
        ],
        BACK: (2, 13, [
            '...........g',
            '..........w.',
            '.......g.w..',
            '........gg..',
            '.......lbg..',
            '......lbo...',
            '.....lbo....',
            '....lbo.....',
            '...lbo......',
            '..lbo.......',
            '.lbo........',
            '.oo.........',
        ]),
        SIDE: (1, 13, [
            '.g.',
            '.w.',
            'ggg',
            '.l.',
            '.b.',
            '.b.',
            '.b.',
            '.b.',
            '.b.',
            '.b.',
            '.o.',
        ]),
    }


def shield(ramp):
    o, s, b, l = ramp
    return {
        'colors': {'o': o, 's': s, 'b': b, 'l': l, 'r': RED},
        BACK: (4, 17, [
            '.oooooo.',
            'oblbbbso',
            'olbrrbso',
            'obrrrrso',
            'obrrrrso',
            'obbrrbso',
            'osbbbsso',
            '.oooooo.',
        ]),
        SIDE: (0, 17, [
            '.oo',
            'obo',
            'obo',
            'oro',
            'oro',
            'obo',
            'oso',
            '.oo',
        ]),
    }


# The top effort's mark: a violet gem, outlined dark so it shows on hair, steel
# and the gold helm alike.
GEM = {
    'colors': {'v': '#c264ff', 'w': WHITE, 'o': '#3a1466'},
    # On the top of the head: a walking character's head starts at row 2.
    FRONT: (6, -1, ['ovo', 'vwv', 'ovo']),
    BACK: (6, -1, ['ovo', 'vwv', 'ovo']),
    SIDE: (7, 2, ['ovo', 'vwv', 'ovo']),
}

BASE_TOP = {FRONT: 2, BACK: 2, SIDE: 5}


def stamp(sheet, piece, tops):
    """A piece in every frame but the seated one, moved with the head. A view
    holds one block (x, y, rows) or a list of them."""
    for view in (FRONT, BACK, SIDE):
        if view not in piece:
            continue
        blocks = piece[view] if isinstance(piece[view], list) else [piece[view]]
        for f in range(FRAMES - 1):
            dy = tops[view][f] - BASE_TOP[view]
            for x0, y0, rows in blocks:
                for y, line in enumerate(rows):
                    for x, ch in enumerate(line):
                        if ch == '.':
                            continue
                        px, py = x0 + x, y0 + y + dy
                        if 0 <= px < FW and 0 <= py < FH:
                            sheet.putpixel((f * FW + px, view * FH + py), rgba(piece['colors'][ch]))


def seat(sheet):
    """The seated frame from the typing frames, as core/src/assets/seatedFrame.ts does."""
    for view in range(ROWS):
        for y in range(FH):
            for x in range(FW):
                src = TYPE1 if view == SIDE or x >= FW // 2 else TYPE2
                sheet.putpixel(
                    (SEATED * FW + x, view * FH + y),
                    sheet.getpixel((src * FW + x, view * FH + y)),
                )


def sheets():
    body = Image.open(os.path.join(ART, 'body', 'flat.png')).convert('RGBA')
    shirt = Image.open(os.path.join(ART, 'top', 'tshirt.png')).convert('RGBA')
    tops = head_tops(body)

    def build(armour_ramp=None, pieces=()):
        sheet = armour(shirt, armour_ramp) if armour_ramp else Image.new('RGBA', body.size)
        for piece in pieces:
            stamp(sheet, piece, tops)
        seat(sheet)
        return sheet

    return {
        'haiku': build(None, [sword(WOOD)]),
        'sonnet': build(LEATHER, [sword(STEEL[1])]),
        'opus': build(STEEL, [sword(STEEL[1]), shield(STEEL), helm(STEEL, None)]),
        'fable': build(GOLD, [sword(GOLD[2]), shield(GOLD), helm(GOLD, RED)]),
        'gem': build(None, [GEM]),
    }


def main():
    out = os.path.join(ART, 'gear')
    check = '--check' in sys.argv
    os.makedirs(out, exist_ok=True)
    bad = []
    for name, sheet in sheets().items():
        path = os.path.join(out, name + '.png')
        if check:
            if not os.path.exists(path) or list(Image.open(path).convert('RGBA').getdata()) != list(sheet.getdata()):
                bad.append(name)
        else:
            sheet.save(path, optimize=True)
    if bad:
        sys.exit('gear art differs from gear-art.py: ' + ', '.join(bad))


if __name__ == '__main__':
    main()
