#!/usr/bin/env python3
"""pixel-agents-secure (local): draws the model gear sheets in
webview-ui/src/characters/art/gear/. The PNGs are committed; this script is how
they were made, and how to change them:

    python3 -I scripts/gear-art.py            # rewrite the PNGs
    python3 -I scripts/gear-art.py --check    # fail if the folder differs from what this draws

Each model family is a class with its own outline, and the effort adds to it:

    haiku   squire: a sword on the back            +1 headband     +2 cape
    sonnet  archer: hood, tunic, bow and quiver    +1 feather      +2 cape
    opus    knight: helm, plate, shield and sword  +1 plume        +2 cape
    fable   mage: pointed hat, robe and staff      +1 hat star     +2 cape

<tier>_<n>.png is the whole gear with n additions, one 128x96 sheet (8 frames x
3 rows of 16x32: front, back, right) laid over the finished character
(characters/renderer.ts). <tier>_hide.png marks where the character's hair and
hat are not drawn under the headgear.

Armour, tunic and robe are the wardrobe's own shirt, jeans and skirt art in
other tones, so they follow the limbs in every frame; the rest is stamped at
each frame's head position, read from the body's art. Needs Pillow.
"""
import os
import sys

from PIL import Image

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webview-ui', 'src', 'characters', 'art')
FW, FH, FRAMES, ROWS = 16, 32, 8, 3
FRONT, BACK, SIDE = 0, 1, 2
VIEWS = (FRONT, BACK, SIDE)
TYPE1, TYPE2, SEATED = 3, 4, 7
# Where the head starts in a view's first frame: pieces are placed for it.
BASE_TOP = {FRONT: 2, BACK: 2, SIDE: 5}

# Ramps: outline, shade, base, light.
STEEL = ['#2b3440', '#7f8fa3', '#a3b4c8', '#e6eef6']
IRON = ['#232a33', '#56637a', '#74839b', '#aab8cc']
GREEN = ['#1f3d1c', '#3f7a36', '#57a14a', '#8fd07a']
PURPLE = ['#2a1250', '#5a2ea0', '#7b45d0', '#b58cff']
GOLD = ['#6b4a12', '#c8962a', '#e8bb3e', '#fff2a8']
CAPES = {
    'haiku': ['#4a1616', '#a03030', '#c84a4a'],
    'sonnet': ['#16301a', '#2f6a35', '#4c9150'],
    'opus': ['#14244d', '#2c4fa3', '#4f78d6'],
    'fable': ['#6b4a12', '#e8bb3e', '#fff2a8'],
}
WOOD, RED, DARK_RED, WHITE = '#c9965a', '#d23a3a', '#7a1c1c', '#ffffff'
QUIVER = '#7a4a22'


def rgba(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def art(path):
    return Image.open(os.path.join(ART, *path.split('/')) + '.png').convert('RGBA')


def head_tops(body):
    """Each frame's first opaque row: where the head starts."""
    return [
        [body.crop((f * FW, r * FH, (f + 1) * FW, (r + 1) * FH)).getbbox()[1] for f in range(FRAMES)]
        for r in range(ROWS)
    ]


def recolour(source, ramp):
    """A wardrobe piece in a ramp, its tones darkest to lightest."""
    tones = sorted({p[:3] for p in source.getdata() if p[3] > 0}, key=sum)
    to = {t: rgba(ramp[min(i, len(ramp) - 1)]) for i, t in enumerate(tones)}
    out = Image.new('RGBA', source.size)
    out.putdata([to[p[:3]] if p[3] > 0 else (0, 0, 0, 0) for p in source.getdata()])
    return out


# Pieces as text, per view: (x, y, rows) or a list of them, placed for a head
# starting at BASE_TOP. '.' is nothing; other letters index the piece's colours.

def helm():
    o, s, b, l = STEEL
    return {
        'colors': {'o': o, 's': s, 'b': b, 'l': l},
        FRONT: (2, 0, [
            '....obbo....',
            '..oooooooo..',
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
            '....obbo....',
            '..oooooooo..',
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
            '...obbo.....',
            '..ooooooo...',
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
        # Hair stays only in the face opening and below the helm.
        'hide': {
            FRONT: lambda x, y: y <= 7 or ((x < 4 or x > 11) and y <= 11),
            BACK: lambda x, y: y <= 11,
            SIDE: lambda x, y: y <= 10 or (x <= 4 and y <= 14),
        },
    }


def hood():
    o, s, b, l = GREEN
    return {
        'colors': {'o': o, 's': s, 'b': b, 'l': l},
        FRONT: (2, 0, [
            '...oooooo...',
            '..obbbbbbo..',
            '.oblbbbbbbo.',
            'obllbbbbbbso',
            'obbbbbbbbbso',
            'obbbbbbbbbso',
            'obbssssssbso',
            'obs......sbo',
            'os........so',
            'os........so',
            'os........so',
            'os........so',
            'obs......sbo',
            '.oo......oo.',
        ]),
        BACK: (2, 0, [
            '...oooooo...',
            '..obbbbbbo..',
            '.obbbbbblbo.',
            'obbbbbbbllbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'osbbbbbbbbso',
            '.osbbbbbbso.',
            '..ossbbsso..',
            '...oossoo...',
        ]),
        SIDE: (2, 3, [
            '...ooooo....',
            '..obbbbbbo..',
            '.obbbbblbbo.',
            'obbbbbbllbbo',
            'obbbbbbbbbso',
            'obbbbbbbssoo',
            'obbbbbbso...',
            'obbbbbso....',
            'obbbbbo.....',
            'obbbbso.....',
            '.obbso......',
            '..ooo.......',
        ]),
        'hide': {
            FRONT: lambda x, y: y <= 6 or ((x < 4 or x > 11) and y <= 13),
            BACK: lambda x, y: y <= 13,
            SIDE: lambda x, y: y <= 8 or (x <= 8 and y <= 14),
        },
    }


def hat():
    o, s, b, l = PURPLE
    return {
        'colors': {'o': o, 's': s, 'b': b, 'l': l, 'g': GOLD[2]},
        FRONT: (1, 0, [
            '.......ooo....',
            '......obblo...',
            '.....obbbo....',
            '....obblbbo...',
            '...oggggggo...',
            '.oobbbbbbbboo.',
            'obblbbbbbbbbso',
            '.oooooooooooo.',
        ]),
        BACK: (1, 0, [
            '....ooo.......',
            '...olbbo......',
            '....obbbo.....',
            '...obblbbo....',
            '...oggggggo...',
            '.oobbbbbbbboo.',
            'osbbbbbbbblbbo',
            '.oooooooooooo.',
        ]),
        SIDE: (1, 3, [
            '......ooo.....',
            '.....obblo....',
            '....obbbo.....',
            '...obblbbo....',
            '...oggggggo...',
            '.oobbbbbbbboo.',
            'obbbbbbbblbbso',
            '.oooooooooooo.',
        ]),
        # A hat sits on the hair: whatever falls below the brim shows.
        'hide': {
            FRONT: lambda x, y: y <= 6,
            BACK: lambda x, y: y <= 6,
            SIDE: lambda x, y: y <= 9,
        },
    }


def sword():
    return {
        'colors': {'o': STEEL[0], 'b': STEEL[2], 'l': STEEL[3], 'g': STEEL[1], 'w': WOOD},
        # Across the back: from the front, the hilt over one shoulder and the
        # tip by the other hip.
        FRONT: [
            (11, 9, ['...og', '..owo', '.owo.', 'ogo..', 'gggo.', '.og..']),
            (0, 21, ['..o', '.lo', 'lbo', 'bo.', 'o..']),
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
        SIDE: (1, 13, ['.g.', '.w.', 'ggg', '.l.', '.b.', '.b.', '.b.', '.b.', '.b.', '.b.', '.o.']),
    }


def shield():
    o, s, b, l = STEEL
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
        SIDE: (0, 17, ['.oo', 'obo', 'obo', 'oro', 'oro', 'obo', 'oso', '.oo']),
    }


def bow():
    return {
        'colors': {'w': WOOD, 'o': '#5a3a1c', 'q': QUIVER, 'r': RED, 'f': WHITE, 's': '#f1e3b0'},
        # Slung across the body: the string over the chest, the bow's limbs past
        # one shoulder and the other hip, the quiver's arrows over the far shoulder.
        FRONT: [
            (12, 8, ['r.r.', 'frfr', '.ff.', '.oqo', '.oqo']),
            (4, 17, ['s......', '.s.....', '..s....', '...s...', '....s..', '.....s.', '......s']),
            (0, 10, ['..o', '.ow', 'oww', 'ow.', 'ow.', 'ow.']),
            (12, 22, ['.wo', '.wo', 'wwo', 'wo.', 'o..']),
        ],
        BACK: [
            (3, 13, [
                '.......r.r',
                '.......rfr',
                '......oqqo',
                '.....oqqo.',
                '....oqqo..',
                '...oqqo...',
                '..oqqo....',
                '..ooo.....',
            ]),
            (1, 15, ['.o', 'ow', 'w.', 'w.', 'w.', 'w.', 'w.', 'w.', 'ow', '.o']),
        ],
        SIDE: [
            (1, 13, ['r.r', 'rfr', 'oqo', 'oqo', 'oqo', 'oqo', 'oqo', '.o.']),
            (0, 12, ['.o', 'ow', 'w.', 'w.', 'w.', 'w.', 'w.', 'w.', 'w.', 'w.', 'w.', 'ow', '.o']),
        ],
    }


def staff():
    return {
        'colors': {'w': WOOD, 'o': '#1b6f8a', 'c': '#7fe9ff', 'f': WHITE},
        # Across the back: its orb over one shoulder, its foot by the other hip.
        FRONT: [
            (12, 8, ['.oo.', 'ocfo', 'occo', '.oo.', '..w.', '.w..']),
            (0, 22, ['..w', '.w.', 'w..']),
        ],
        BACK: (2, 12, [
            '.........oo.',
            '........ocfo',
            '........occo',
            '.......w.oo.',
            '......w.....',
            '.....w......',
            '....w.......',
            '...w........',
            '..w.........',
            '.w..........',
            'w...........',
        ]),
        SIDE: (0, 10, ['.oo.', 'ocfo', 'occo', '.oo.'] + ['.w..'] * 12),
    }


def cape(ramp):
    o, b, l = ramp
    return {
        'colors': {'o': o, 'b': b, 'l': l},
        # From the front, only what hangs past the arms.
        FRONT: (2, 23, [
            'bo........ob',
            'bo........ob',
            'bbo......obb',
            'bbo......obb',
            'ooo......ooo',
        ]),
        BACK: (2, 16, [
            '..oooooooo..',
            '.obbbbbbbbo.',
            '.obbbbbbbbo.',
            '.oblbbbblbo.',
            '.oblbbbblbo.',
            'obblbbbblbbo',
            'obblbbbblbbo',
            'obblbbbblbbo',
            'obbbbbbbbbbo',
            'obbbbbbbbbbo',
            'oobboobboobo',
            '.oo..oo..oo.',
        ]),
        SIDE: (1, 16, [
            '...oo',
            '..obo',
            '..obo',
            '.oblo',
            '.oblo',
            '.oblo',
            'obblo',
            'obbbo',
            'obbbo',
            'obbbo',
            'oobbo',
            '.ooo.',
        ]),
    }


HEADBAND = {
    'colors': {'r': RED, 'd': DARK_RED},
    FRONT: [(2, 5, ['drrrrrrrrrrd']), (13, 6, ['r', 'd'])],
    BACK: [(2, 5, ['drrrrrrrrrrd']), (6, 6, ['.rr.', 'r..r', 'd..d'])],
    SIDE: [(2, 8, ['drrrrrrrrrrr']), (1, 9, ['r.', 'rr', 'd.'])],
}
FEATHER = {
    'colors': {'f': WHITE, 'r': RED},
    FRONT: (10, 0, ['..f', '.fr', 'fr.', 'f..']),
    BACK: (3, 0, ['f..', 'rf.', '.rf', '..f']),
    SIDE: (4, 2, ['..f', '.fr', 'fr.', 'f..']),
}
PLUME = {
    'colors': {'r': RED, 'd': DARK_RED},
    FRONT: (5, -1, ['.rrrr.', 'rrrrrr', '.drrd.']),
    BACK: (5, -1, ['.rrrr.', 'rrrrrr', '.drrd.']),
    SIDE: (3, 2, ['.rrrrr.', 'rrrrrrd', '.ddd...']),
}
HAT_STAR = {
    'colors': {'y': GOLD[3], 'g': GOLD[2], 'f': WHITE},
    FRONT: (7, 0, ['.y.', 'yfy', '.y.']),
    BACK: (4, 0, ['.y.', 'yfy', '.y.']),
    SIDE: (6, 3, ['.y.', 'yfy', '.y.']),
}


def stamp(sheet, piece, tops, views=VIEWS):
    """A piece in every frame but the seated one, moved with the head."""
    for view in views:
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


def hide_sheet(headgear, tops):
    """Where hair and hats are not drawn under a headgear."""
    sheet = Image.new('RGBA', (FW * FRAMES, FH * ROWS))
    for view in VIEWS:
        hidden = headgear['hide'][view]
        for f in range(FRAMES - 1):
            dy = tops[view][f] - BASE_TOP[view]
            for y in range(FH):
                for x in range(FW):
                    if hidden(x, y - dy):
                        sheet.putpixel((f * FW + x, view * FH + y), (0, 0, 0, 255))
    seat(sheet)
    return sheet


def sheets():
    tops = head_tops(art('body/flat'))
    shirt, sleeves = art('top/tshirt'), art('top/long_sleeved_shirt')
    jeans, skirt = art('pants/jeans'), art('pants/long_skirt')

    # A class: what dresses the body, what it carries, its headgear, and the
    # head addition of the first effort step. The cape is the second step.
    classes = {
        'haiku': ([], [sword()], None, HEADBAND),
        'sonnet': ([recolour(shirt, GREEN)], [bow()], hood(), FEATHER),
        'opus': ([recolour(jeans, IRON), recolour(sleeves, STEEL)], [sword(), shield()], helm(), PLUME),
        'fable': ([recolour(skirt, PURPLE), recolour(sleeves, PURPLE)], [staff()], hat(), HAT_STAR),
    }
    out = {}
    for tier, (body, carried, headgear, addition) in classes.items():
        for additions in range(3):
            sheet = Image.new('RGBA', (FW * FRAMES, FH * ROWS))
            worn_cape = cape(CAPES[tier]) if additions == 2 else None
            # The cape hangs behind: under the clothes from the front and the
            # side, over them from the back.
            if worn_cape:
                stamp(sheet, worn_cape, tops, (FRONT, SIDE))
            for piece in body:
                sheet.alpha_composite(piece)
            if worn_cape:
                stamp(sheet, worn_cape, tops, (BACK,))
            for piece in carried:
                stamp(sheet, piece, tops)
            if headgear:
                stamp(sheet, headgear, tops)
            if additions >= 1:
                stamp(sheet, addition, tops)
            seat(sheet)
            out[f'{tier}_{additions}'] = sheet
        if headgear:
            out[f'{tier}_hide'] = hide_sheet(headgear, tops)
    return out


def main():
    folder = os.path.join(ART, 'gear')
    check = '--check' in sys.argv
    os.makedirs(folder, exist_ok=True)
    drawn = sheets()
    on_disk = {f[:-4] for f in os.listdir(folder) if f.endswith('.png')}
    if check:
        bad = sorted(on_disk ^ set(drawn))
        for name in sorted(on_disk & set(drawn)):
            saved = Image.open(os.path.join(folder, name + '.png')).convert('RGBA')
            if list(saved.getdata()) != list(drawn[name].getdata()):
                bad.append(name)
        if bad:
            sys.exit('gear art differs from gear-art.py: ' + ', '.join(bad))
        return
    for name in on_disk - set(drawn):
        os.remove(os.path.join(folder, name + '.png'))
    for name, sheet in drawn.items():
        sheet.save(os.path.join(folder, name + '.png'), optimize=True)


if __name__ == '__main__':
    main()
