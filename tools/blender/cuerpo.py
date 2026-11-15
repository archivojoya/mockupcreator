"""Horma invisible para vestir la camiseta: un cuerpo de hombros rectos y
brazos bajos, hecho a la medida de la prenda (no al revés).

Sale de las medidas de la prenda ya sin márgenes: el ancho del escote, la
punta y la caída del hombro, el contorno de pecho y de ruedo. La silueta
(cuánto se ve de ancho de frente, el ángulo del brazo) sale de la muestra de
Demian (referencias/blender/camiseta-short.webp); el fondo de cada corte se
calcula para que el contorno de la horma sea el de la prenda: la tela apoya
sin sobrar y no hace bollos.

El cuerpo es una suma suave de formas simples (torso por cortes, cuello,
hombros, deltoides, brazos) en una grilla de distancias; de ahí sale la
malla. La misma grilla da el cuerpo "fino" (unos centímetros hacia adentro)
con el que se cose: después se infla hasta el definitivo.

Unidades: metros. z arriba, el frente mira a -y, z = 0 en el punto del
cuello (donde el hombro llega al escote).
"""
import math

import numpy as np
from scipy import ndimage, optimize
from scipy.interpolate import PchipInterpolator
from skimage import measure


def smin(a, b, k):
    """Unión suave: como min(a, b) pero con un filete de radio ~k."""
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def perimeter(a, b, n, m=720):
    t = np.linspace(0, 2 * np.pi, m, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    x = a * np.sign(c) * np.abs(c) ** (2 / n)
    y = b * np.sign(s) * np.abs(s) ** (2 / n)
    return float(np.hypot(np.diff(np.r_[x, x[0]]), np.diff(np.r_[y, y[0]])).sum())


def depth_for(a, n, per):
    """Medio fondo del corte (superelipse de medio ancho a) que da el contorno pedido."""
    return optimize.brentq(lambda b: perimeter(a, b, n) - per, 0.03, 0.6)


DEFAULTS = {
    # Medidas de la prenda (las pone coser.py desde el molde).
    'np_x': 0.0925, 'sp_x': 0.230, 'sp_z': -0.044, 'chest': 1.12, 'hem': 1.094, 'length': 0.76,
    # Silueta de la muestra: medio ancho que se ve de frente (pecho, cintura, ruedo).
    'a_chest': 0.176, 'a_waist': 0.168, 'a_hem': 0.193,
    'n_chest': 3.0, 'n_waist': 2.8, 'n_hem': 2.6,  # cuánto de cuadrado tiene cada corte
    'ease_chest': 0.010, 'ease_hem': 0.025, 'waist_in': 0.009,
    'chest_z': -0.26,  # altura donde la prenda ya es un tubo cerrado (bajo la axila)
    'pit_in': 0.875,  # ancho del torso a la altura de la axila, contra el del pecho
    # Hombro, cuello y brazo.
    'yoke_r': 0.050, 'yoke_ry': 0.062, 'shoulder_y': 0.005,
    'neck_r': 0.061, 'neck_y0': -0.005, 'neck_y1': -0.030,
    'delt_out': 0.024,  # cuánto sobresale el deltoides de la punta del hombro de la prenda
    'delt': [0.046, 0.063, 0.054],
    'arm_angle': 21.0, 'arm_fwd': 6.0, 'arm_len': 0.36,
    'arm_r': [0.042, 0.038], 'arm_ry': [0.056, 0.050],
    'k_yoke': 0.04, 'k_neck': 0.035, 'k_delt': 0.03, 'k_arm': 0.015,
    # La tela queda a esta distancia de la malla de choque (espesores del simulador).
    'skin': 0.006, 'thin': 0.018, 'voxel': 0.006,
}


class Cuerpo:
    def __init__(self, opts=None):
        o = self.o = {**DEFAULTS, **(opts or {})}
        h = o['voxel']
        reach = o['sp_x'] + o['delt_out'] + o['arm_len'] * math.sin(math.radians(o['arm_angle'])) + 0.09
        self.lo = np.array([-reach, -0.26, -o['length'] - 0.26])
        hi = np.array([reach, 0.26, 0.20])
        self.h = h
        shape = np.ceil((hi - self.lo) / h).astype(int) + 1
        ax = [self.lo[i] + h * np.arange(shape[i]) for i in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing='ij')
        self.D = self._field(X, Y, Z).astype(np.float32)
        self.G = [g.astype(np.float32) for g in np.gradient(self.D, h)]

    # --- formas -----------------------------------------------------------
    def _torso_rows(self):
        o = self.o
        bc = depth_for(o['a_chest'], o['n_chest'], o['chest'] - o['ease_chest'])
        bh = depth_for(o['a_hem'], o['n_hem'], o['hem'] - o['ease_hem'])
        zc, L = o['chest_z'], o['length']
        self.b_chest, self.b_hem = bc, bh
        ac = o['a_chest']
        # (z, medio ancho, medio fondo, centro, exponente)
        return [
            # Bajo el brazo el torso es más angosto que el tubo de la prenda:
            # la axila del cuerpo queda unos 10 cm más arriba que la de la
            # camiseta. (Con el torso lleno hasta arriba la prenda se colgaba
            # de la axila y se arrugaba sobre los hombros.)
            (-0.040, ac * 0.68, 0.050, 0.003, 2.2),
            (-0.065, ac * 0.97, 0.078, 0.003, 2.3),
            (-0.095, ac * 0.95, 0.102, 0.002, 2.4),
            (-0.135, ac * o['pit_in'], bc * 0.85, 0.0, 2.6),
            (-0.185, ac * (o['pit_in'] + 0.04), bc * 0.94, 0.0, 2.8),
            (zc, ac, bc, 0.0, o['n_chest']),
            (zc - 0.08, ac - 0.001, bc, 0.0, o['n_chest']),
            (zc - 0.45 * (L + zc), o['a_waist'], bc - o['waist_in'], 0.0, o['n_waist']),
            (zc - 0.75 * (L + zc), (o['a_waist'] + o['a_hem']) / 2 + 0.004, (bc - o['waist_in'] + bh) / 2, 0.0, (o['n_waist'] + o['n_hem']) / 2),
            (-L + 0.03, o['a_hem'], bh, 0.0, o['n_hem']),
            (-L - 0.08, o['a_hem'] + 0.002, bh, 0.0, o['n_hem']),
            (-L - 0.30, o['a_hem'] + 0.002, bh, 0.0, o['n_hem']),
        ]

    def _torso(self, X, Y, Z):
        rows = sorted(self._torso_rows())
        zs = np.array([r[0] for r in rows])
        col = [PchipInterpolator(zs, [r[k] for r in rows], extrapolate=False) for k in (1, 2, 3, 4)]
        z1 = np.clip(Z[0, 0, :], zs[0], zs[-1])
        a, b, c, n = (f(z1)[None, None, :] for f in col)
        g = ((np.abs(X) / a) ** n + (np.abs(Y - c) / b) ** n) ** (1 / n)
        grad = np.sqrt(sum(d ** 2 for d in np.gradient(g, self.h)))
        d = (g - 1) / np.maximum(grad, 3.0)
        # Tapas: arriba queda dentro de los hombros; abajo, lejos del ruedo.
        return np.maximum(np.maximum(d, Z - zs[-1]), zs[0] + self.h * 2 - Z)

    @staticmethod
    def _capsule(X, Y, Z, A, B, r, ry):
        """Cono redondeado de A a B con corte ovalado: radio r[0]→r[1] de
        costado y ry[0]→ry[1] de fondo (hacia y)."""
        A, B = np.asarray(A, float), np.asarray(B, float)
        d = B - A
        L = np.linalg.norm(d)
        d /= L
        ey = np.array([0, 1.0, 0])
        ey = ey - d * ey.dot(d)
        ey /= np.linalg.norm(ey)
        ex = np.cross(ey, d)
        px, py, pz = X - A[0], Y - A[1], Z - A[2]
        u = px * d[0] + py * d[1] + pz * d[2]
        v = px * ex[0] + py * ex[1] + pz * ex[2]
        w = px * ey[0] + py * ey[1] + pz * ey[2]
        t = np.clip(u / L, 0, 1)
        rl = r[0] + (r[1] - r[0]) * t
        rd = ry[0] + (ry[1] - ry[0]) * t
        du = u - t * L
        return np.sqrt(du ** 2 + v ** 2 + (w * rl / rd) ** 2) - rl

    @staticmethod
    def _ellipsoid(X, Y, Z, C, R):
        px, py, pz = (X - C[0]) / R[0], (Y - C[1]) / R[1], (Z - C[2]) / R[2]
        k0 = np.sqrt(px ** 2 + py ** 2 + pz ** 2)
        k1 = np.sqrt((px / R[0]) ** 2 + (py / R[1]) ** 2 + (pz / R[2]) ** 2)
        return k0 * (k0 - 1) / np.maximum(k1, 1e-6)

    def arm_axis(self, side):
        """Articulación del hombro y dirección del brazo (side = +1 o -1)."""
        o = self.o
        th, fw = math.radians(o['arm_angle']), math.radians(o['arm_fwd'])
        d = np.array([side * math.sin(th), -math.sin(fw) * math.cos(th), -math.cos(th) * math.cos(fw)])
        d /= np.linalg.norm(d)
        slope = -o['sp_z'] / (o['sp_x'] - o['np_x'])
        jx = o['sp_x'] + o['delt_out'] - o['delt'][0]
        ridge = -(jx - o['np_x']) * slope
        jz = ridge - 0.003 - o['delt'][2]
        return np.array([side * jx, o['shoulder_y'], jz]), d

    def _field(self, X, Y, Z):
        o = self.o
        D = self._torso(X, Y, Z)
        # Cuello: un caño apenas echado hacia adelante.
        neck = self._capsule(X, Y, Z, (0, o['neck_y0'], -0.08), (0, o['neck_y1'], 0.16),
                             (o['neck_r'], o['neck_r'] * 0.97), (o['neck_r'], o['neck_r'] * 0.97))
        slope = -o['sp_z'] / (o['sp_x'] - o['np_x'])
        cosl = 1 / math.hypot(1, slope)
        r, ry = o['yoke_r'], o['yoke_ry']
        for side in (1, -1):
            J, d = self.arm_axis(side)
            # Hombro: una barra redonda cuyo lomo es la costura del hombro.
            def axis_z(x):
                return -(x - o['np_x']) * slope - r / cosl
            x0, x1 = 0.03, abs(J[0])
            yoke = self._capsule(X, Y, Z, (side * x0, o['shoulder_y'], axis_z(x0)), (side * x1, o['shoulder_y'], axis_z(x1)),
                                 (r, r), (ry, ry + 0.004))
            D = smin(D, yoke, o['k_yoke'])
            delt = self._ellipsoid(X, Y, Z, J, o['delt'])
            D = smin(D, delt, o['k_delt'])
            arm = self._capsule(X, Y, Z, J, J + d * o['arm_len'], o['arm_r'], o['arm_ry'])
            D = smin(D, arm, o['k_arm'])
        D = smin(D, neck, o['k_neck'])
        return D

    # --- consultas ----------------------------------------------------------
    def _sample(self, vol, P):
        idx = ((np.asarray(P) - self.lo) / self.h).T
        return ndimage.map_coordinates(vol, idx, order=1, mode='nearest')

    def dist(self, P):
        """Distancia de cada punto a la superficie donde apoya la tela."""
        return self._sample(self.D, P)

    def normal(self, P):
        g = np.stack([self._sample(G, P) for G in self.G], axis=1)
        return g / np.maximum(np.linalg.norm(g, axis=1), 1e-6)[:, None]

    def push_out(self, P, level, iters=6):
        """Lleva hacia afuera los puntos que quedan por dentro de un nivel."""
        P = np.array(P, float)
        for _ in range(iters):
            d = self.dist(P)
            m = d < level
            if not m.any():
                break
            P[m] += self.normal(P[m]) * (level - d[m])[:, None]
        return P

    def to_level(self, P, level, iters=5):
        P = np.array(P, float)
        for _ in range(iters):
            P += self.normal(P) * (level - self.dist(P))[:, None]
        return P

    def mesh(self):
        """Malla de choque (la tela apoya 'skin' más afuera) y sus puntos
        en el cuerpo fino con el que se cose."""
        o = self.o
        V, F, _, _ = measure.marching_cubes(self.D, level=-o['skin'], spacing=(self.h,) * 3)
        V = V + self.lo
        # Las caras miran hacia afuera.
        a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
        if np.einsum('ij,ij->i', a, np.cross(b, c)).sum() < 0:
            F = F[:, ::-1]
        thin = self.to_level(V, -o['skin'] - o['thin'])
        # Una cara que queda al revés en el cuerpo fino atrapa la tela (pasó
        # con el lomo del hombro angosto y 2,5 cm: la prenda subía arrugándose
        # sobre los hombros). Las que queden se corrigen en el lugar.
        n0 = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        disp = thin - V
        nb = [[] for _ in range(len(V))]
        for i, j in E:
            nb[i].append(j)
        for _ in range(60):
            T = V + disp
            flipped = np.einsum('ij,ij->i', np.cross(T[F[:, 1]] - T[F[:, 0]], T[F[:, 2]] - T[F[:, 0]]), n0) < 0
            if not flipped.any():
                break
            # Los puntos de esas caras y sus vecinos entran menos (ahí el
            # cuerpo es más angosto que lo que se lo quiere afinar).
            idx = set(np.unique(F[flipped]).tolist())
            idx |= {j for i in list(idx) for j in nb[i]}
            idx = np.array(sorted(idx))
            disp[idx] *= 0.8
        self.flipped = int(flipped.sum())
        return V, F, V + disp


if __name__ == '__main__':
    import sys
    import time
    t = time.time()
    c = Cuerpo()
    V, F, T = c.mesh()
    print(f'{len(V)} puntos, {len(F)} caras, {c.flipped} dadas vuelta en el fino, {time.time() - t:.1f}s; fondo pecho {c.b_chest * 200:.1f} cm, ruedo {c.b_hem * 200:.1f} cm')
    print('articulación', c.arm_axis(1))
    for z in (0.02, 0, -0.02, -0.044, -0.07, -0.10, -0.15, -0.20, -0.24, -0.30, -0.45, -0.60, -0.73):
        m = np.abs(V[:, 2] - z) < 0.004
        print(f'z {z * 100:6.1f}  ancho {np.ptp(V[m, 0]) * 100:5.1f}  y {V[m, 1].min() * 100:6.1f} .. {V[m, 1].max() * 100:5.1f}')
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'w') as f:
            for v in V:
                f.write('v %.5f %.5f %.5f\n' % tuple(v))
            for a, b, cc in F + 1:
                f.write(f'f {a} {b} {cc}\n')
