"""Corta las piezas de un molde SVG de camiseta (frente, espalda, dos mangas)
en mallas planas de triángulos y arma los pares de costura.

    python piezas.py molde.svg salida.json [paso_cm]

Cada pieza se toma del contorno (trazo) de su grupo; las esquinas salen de
los quiebres del trazo. Los bordes que se cosen se reparten con la misma
cantidad de puntos en las dos piezas, así cada punto tiene su pareja.
Coordenadas de salida: las del SVG (unidades de Illustrator, 1 pt).
"""
import json
import math
import re
import sys
import cmath
import xml.etree.ElementTree as ET

import numpy as np
import triangle
from svgpathtools import parse_path

NS = {'s': 'http://www.w3.org/2000/svg'}
CM = 72 / 2.54  # unidades por cm

GROUPS = {
    'front': ('frente',),
    'back': ('espalda',),
    'sleeveR': ('manga_derecha', 'manga derecha'),
    'sleeveL': ('manga_izquierda', 'manga izquierda'),
}


def outline_paths(svg):
    root = ET.parse(svg).getroot()
    out = {}
    for g in root.iter('{http://www.w3.org/2000/svg}g'):
        gid = (g.get('id') or '').lower()
        for key, names in GROUPS.items():
            if key in out or not any(gid.startswith(n) for n in names):
                continue
            # El contorno: el trazo sin relleno, hijo directo del grupo.
            cands = [p for p in g.findall('s:path', NS) if p.get('class') == 'st9' or (p.get('fill') == 'none')]
            if cands:
                out[key] = parse_path(cands[0].get('d'))
    return out


def corners(path, min_turn=20, min_len=2.0):
    """Puntos de quiebre del trazo y el contorno denso entre ellos."""
    segs = [s for s in path if s.length() > min_len]
    pts, marks = [], []
    for i, s in enumerate(segs):
        prev = segs[i - 1]
        turn = math.degrees(abs(cmath.phase(s.unit_tangent(0) / prev.unit_tangent(1))))
        if turn > min_turn:
            marks.append(len(pts))
        n = max(4, int(s.length() / 1.5))
        for t in np.linspace(0, 1, n, endpoint=False):
            p = s.point(t)
            pts.append((p.real, p.imag))
    return np.array(pts), marks


def close_notches(P, marks, r=12.0):
    """Rellena muescas y piquetes del contorno (marcas de aplome de pocos mm):
    un cierre morfológico (agrandar y achicar r) no toca las esquinas
    salientes ni las curvas de radio mayor que r."""
    from shapely.geometry import Polygon
    poly = Polygon(P)
    closed = poly.buffer(r, join_style='mitre', mitre_limit=10).buffer(-r, join_style='mitre', mitre_limit=10)
    ring = closed.exterior.segmentize(1.5)
    Q = np.array(ring.coords)[:-1]
    # Mismo sentido de recorrido que el original.
    def area(X):
        return 0.5 * np.sum(X[:, 0] * np.roll(X[:, 1], -1) - np.roll(X[:, 0], -1) * X[:, 1])
    if np.sign(area(Q)) != np.sign(area(P)):
        Q = Q[::-1]
    new_marks = [int(np.argmin(((Q - P[m]) ** 2).sum(1))) for m in marks]
    moved = max(np.linalg.norm(Q[n] - P[m]) for n, m in zip(new_marks, marks))
    assert moved < 1.0, f'una esquina se movió {moved:.2f} unidades'
    # Recorrer desde la primera esquina, en orden.
    order = sorted(range(len(new_marks)), key=lambda i: marks[i])
    return Q, [new_marks[i] for i in order]


def label_body(P, marks):
    C = [(m, P[m]) for m in marks]
    assert len(C) == 8, f'el frente/espalda tiene {len(C)} esquinas, se esperaban 8'
    by_y = sorted(C, key=lambda c: c[1][1])
    neck, shoulder, hem = by_y[:2], by_y[2:4], by_y[-2:]
    under = by_y[4:6]
    lab = {}
    for name, pair in (('NP', neck), ('SP', shoulder), ('UA', under), ('HM', hem)):
        a, b = sorted(pair, key=lambda c: c[1][0])
        lab[name + 'a'], lab[name + 'b'] = a[0], b[0]
    return lab


def label_sleeve(P, marks):
    C = [(m, P[m]) for m in marks]
    xs = [c[1][0] for c in C]
    capa = min(C, key=lambda c: c[1][0])
    capb = max(C, key=lambda c: c[1][0])
    hem = sorted(C, key=lambda c: -c[1][1])[:2]
    ha, hb = sorted(hem, key=lambda c: c[1][0])
    return {'CAPa': capa[0], 'CAPb': capb[0], 'HMa': ha[0], 'HMb': hb[0]}


def walk(P, i, j):
    """Puntos del contorno de i a j (índices cíclicos, en el sentido del trazo)."""
    n = len(P)
    k = [(i + t) % n for t in range(((j - i) % n) + 1)]
    return P[k]


def arclen(Q):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]


def resample(Q, n):
    s = arclen(Q)
    u = np.linspace(0, s[-1], n + 1)
    return np.c_[np.interp(u, s, Q[:, 0]), np.interp(u, s, Q[:, 1])]


def edge(P, i, j):
    """El tramo más corto entre dos esquinas (en uno u otro sentido)."""
    a, b = walk(P, i, j), walk(P, j, i)[::-1]
    return a if arclen(a)[-1] <= arclen(b)[-1] else b


def main(svg, dst, step_cm=1.3):
    h = step_cm * CM
    paths = outline_paths(svg)
    pieces = {}
    for key, path in paths.items():
        P, marks = corners(path)
        P, marks = close_notches(P, marks)
        lab = label_body(P, marks) if key in ('front', 'back') else label_sleeve(P, marks)
        pieces[key] = {'P': P, 'lab': lab}

    # Tramos de cada pieza (en el sentido en que se cosen).
    E = {}
    for key in ('front', 'back'):
        P, L = pieces[key]['P'], pieces[key]['lab']
        E[key] = {
            'neck': edge(P, L['NPa'], L['NPb']),
            'shoulder_a': edge(P, L['NPa'], L['SPa']),
            'shoulder_b': edge(P, L['NPb'], L['SPb']),
            'arm_a': edge(P, L['UAa'], L['SPa']),
            'arm_b': edge(P, L['UAb'], L['SPb']),
            'side_a': edge(P, L['UAa'], L['HMa']),
            'side_b': edge(P, L['UAb'], L['HMb']),
            'hem': edge(P, L['HMa'], L['HMb']),
        }
    for key in ('sleeveL', 'sleeveR'):
        P, L = pieces[key]['P'], pieces[key]['lab']
        # La copa: de las dos vueltas entre CAPa y CAPb, la de arriba.
        w1, w2 = walk(P, L['CAPa'], L['CAPb']), walk(P, L['CAPb'], L['CAPa'])[::-1]
        cap = w1 if w1[:, 1].mean() < w2[:, 1].mean() else w2
        s = arclen(cap)
        mid = int(np.searchsorted(s, s[-1] / 2))
        E[key] = {
            'cap_a': cap[:mid + 1].copy(),  # de CAPa a la punta
            'cap_b': cap[mid:][::-1].copy(),  # de CAPb a la punta
            'under_a': edge(P, L['CAPa'], L['HMa']),
            'under_b': edge(P, L['CAPb'], L['HMb']),
            'hem': edge(P, L['HMa'], L['HMb']),
        }
        # La punta exacta de la copa: el medio del largo.
        tip = resample(cap, 2)[1]
        E[key]['cap_a'][-1] = tip
        E[key]['cap_b'][-1] = tip

    # Costuras: (pieza, tramo) con (pieza, tramo). Lado del mundo: frente
    # visto de frente (a = izquierda de la imagen = -x), espalda vista de
    # atrás (a = +x). Manga derecha (del que la lleva) = -x.
    seams = [
        (('front', 'shoulder_a'), ('back', 'shoulder_b'), 'shoulder'),
        (('front', 'shoulder_b'), ('back', 'shoulder_a'), 'shoulder'),
        (('front', 'side_a'), ('back', 'side_b'), 'side'),
        (('front', 'side_b'), ('back', 'side_a'), 'side'),
        # Manga -x vista desde afuera: su derecha (b) da al frente.
        (('front', 'arm_a'), ('sleeveR', 'cap_b'), 'armhole'),
        (('back', 'arm_b'), ('sleeveR', 'cap_a'), 'armhole'),
        # Manga +x vista desde afuera: su izquierda (a) da al frente.
        (('front', 'arm_b'), ('sleeveL', 'cap_a'), 'armhole'),
        (('back', 'arm_a'), ('sleeveL', 'cap_b'), 'armhole'),
        (('sleeveR', 'under_a'), ('sleeveR', 'under_b'), 'underarm'),
        (('sleeveL', 'under_a'), ('sleeveL', 'under_b'), 'underarm'),
    ]
    counts = {}
    report = []
    for (p1, e1), (p2, e2), kind in seams:
        l1, l2 = arclen(E[p1][e1])[-1], arclen(E[p2][e2])[-1]
        n = max(2, int(round(max(l1, l2) / h)))
        counts[(p1, e1)] = counts[(p2, e2)] = n
        report.append(f'{kind:9s} {p1}.{e1} {l1 / CM:6.2f} cm  {p2}.{e2} {l2 / CM:6.2f} cm  ({l2 / l1 - 1:+.1%})')
    print('\n'.join(report))

    vb = [float(x) for x in re.split(r'[\s,]+', ET.parse(svg).getroot().get('viewBox').strip())]
    out = {'unit_m': 0.0254 / 72, 'viewbox': vb, 'pieces': [], 'seams': []}
    where = {}  # (pieza, tramo) -> índices globales de sus puntos, en orden
    offset = 0
    order = {
        'front': ['neck', 'shoulder_b', 'arm_b', 'side_b', 'hem', 'side_a', 'arm_a', 'shoulder_a'],
        'back': ['neck', 'shoulder_b', 'arm_b', 'side_b', 'hem', 'side_a', 'arm_a', 'shoulder_a'],
        'sleeveL': ['cap_a', 'cap_b', 'under_b', 'hem', 'under_a'],
        'sleeveR': ['cap_a', 'cap_b', 'under_b', 'hem', 'under_a'],
    }
    for key in ('front', 'back', 'sleeveR', 'sleeveL'):
        ring, ids = [], {}
        for name in order[key]:
            Q = E[key][name]
            n = counts.get((key, name)) or max(2, int(round(arclen(Q)[-1] / h)))
            R = resample(Q, n)
            # Recorrido continuo del contorno: el tramo puede venir al revés.
            if ring and np.linalg.norm(R[-1] - ring[-1]) < np.linalg.norm(R[0] - ring[-1]):
                R, rev = R[::-1], True
            else:
                rev = False
            start = len(ring) - 1 if ring else 0
            pts = list(R[1:]) if ring else list(R)
            local = list(range(start, start + len(R)))
            ring.extend(pts)
            ids[name] = local[::-1] if rev else local
        # El último punto repite el primero: cerrar.
        assert np.linalg.norm(ring[-1] - ring[0]) < 1e-3 * CM * 100, (key, ring[-1], ring[0])
        ring = ring[:-1]
        nb = len(ring)
        for name in ids:
            ids[name] = [k % nb for k in ids[name]]
        seg = [(k, (k + 1) % nb) for k in range(nb)]
        A = (h ** 2) * math.sqrt(3) / 4
        tri = triangle.triangulate({'vertices': np.array(ring), 'segments': np.array(seg)}, f'pq30a{A:.1f}Y')
        V, T = tri['vertices'], tri['triangles']
        assert np.allclose(V[:nb], ring)
        # Triángulos vistos desde el lado del diseño (y de la imagen hacia
        # abajo): sentido horario en la imagen = antihorario visto de afuera.
        a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
        cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
        T[cross > 0] = T[cross > 0][:, [0, 2, 1]]
        out['pieces'].append({
            'key': key, 'offset': offset, 'uv': V.tolist(), 'tris': T.tolist(), 'boundary': nb,
            'edges': {name: [k + offset for k in ids[name]] for name in ids},
            'labels': {k: pieces[key]['P'][v].tolist() for k, v in pieces[key]['lab'].items()},
        })
        for name in ids:
            where[(key, name)] = [k + offset for k in ids[name]]
        print(f'{key}: {len(V)} puntos, {len(T)} triángulos, borde {nb}')
        offset += len(V)
    for (p1, e1), (p2, e2), kind in seams:
        A_, B_ = where[(p1, e1)], where[(p2, e2)]
        assert len(A_) == len(B_), (p1, e1, p2, e2)
        out['seams'].append({'kind': kind, 'a': [p1, e1], 'b': [p2, e2], 'pairs': [[i, j] for i, j in zip(A_, B_)]})
    json.dump(out, open(dst, 'w'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.3)
