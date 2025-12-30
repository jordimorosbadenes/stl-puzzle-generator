from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import io
import json
import math
import os
import random
import tempfile
import numpy as np

try:
    from stl import mesh
    _HAVE_NUMPY_STL = True
except Exception:
    _HAVE_NUMPY_STL = False

try:
    import trimesh
    _HAVE_TRIMESH = True
except Exception:
    _HAVE_TRIMESH = False

app = Flask(__name__)
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()] or ["*"]
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=False)

# =============================
# PARÁMETROS
# =============================
DEFAULT_M = 5
DEFAULT_N = 6
DEFAULT_MIN_PIECE_SIZE = 3
DEFAULT_MAX_PIECE_SIZE = 4
DEFAULT_MODE = "Balanced"
DEFAULT_BORDER_PROB = 0.25
DEFAULT_AIR_PROB = 0.0

STL_CUBE_SIZE = 10.0
STL_HEIGHT = 2.0
STL_TOL_MM = 0.3
STL_GAP_MM = 5.0
STL_BASE_BORDER_SIZE_MM = 5.0
STL_BASE_THICKNESS_MM = 1.0
STL_BASE_WALL_HEIGHT_MM = 2.0

PIECE_COLORS = [
    "#FF6666", "#FFCC66", "#99CC66", "#66CCCC", "#6699CC",
    "#CC99CC", "#FF99CC", "#CCCCCC", "#99CC99", "#CC6666",
    "#99CCCC", "#CC9966", "#66CC99", "#9966CC", "#9999CC",
    "#FF9966", "#FF6699", "#66FF99", "#99FFCC", "#FFCC99"
]

# =============================
# UTILIDADES
# =============================
def neighbors(cell, M, N):
    r, c = cell
    for dr, dc in [(1,0),(-1,0),(0,1),(0,-1)]:
        nr, nc = r+dr, c+dc
        if 0 <= nr < M and 0 <= nc < N:
            yield (nr, nc)

# =============================
# PARTITION ALGORITHMS
# =============================
def greedy_partition_basic(grid, min_size=1, max_size=4, attempts_per_cell=30):
    M, N = len(grid), len(grid[0])
    unassigned = {(r,c) for r in range(M) for c in range(N) if grid[r][c] == 1 or grid[r][c] == -1}
    pieces = []
    while unassigned:
        seed = random.choice(list(unassigned))
        target_size = random.randint(min_size, max_size)
        for _ in range(attempts_per_cell):
            piece = {seed}
            frontier = [seed]
            while len(piece) < target_size and frontier:
                cell = random.choice(frontier)
                nbrs = [n for n in neighbors(cell, M, N) if n in unassigned and n not in piece]
                if not nbrs:
                    frontier.remove(cell)
                    continue
                newcell = random.choice(nbrs)
                piece.add(newcell)
                frontier.append(newcell)
            if len(piece) == target_size:
                break
        pieces.append(sorted(piece))
        for c in piece:
            if c in unassigned:
                unassigned.remove(c)
    return pieces

def greedy_partition_force_min(grid, min_size=1, max_size=4, attempts_per_cell=50):
    M, N = len(grid), len(grid[0])
    unassigned = {(r,c) for r in range(M) for c in range(N) if grid[r][c] == 1 or grid[r][c] == -1}
    pieces = []
    while unassigned:
        seed = random.choice(list(unassigned))
        target_size = random.randint(min_size, max_size)
        piece = {seed}
        frontier = [seed]
        attempts = 0
        while len(piece) < target_size and frontier and attempts < attempts_per_cell:
            cell = random.choice(frontier)
            nbrs = [n for n in neighbors(cell, M, N) if n in unassigned and n not in piece]
            if not nbrs:
                frontier.remove(cell)
                continue
            newcell = random.choice(nbrs)
            piece.add(newcell)
            frontier.append(newcell)
            attempts += 1
        if len(piece) < min_size:
            merged = False
            for r,c in list(piece):
                for n in neighbors((r,c), M, N):
                    if n in unassigned and n not in piece:
                        piece.add(n)
                        if len(piece) >= min_size:
                            merged = True
                            break
                if merged:
                    break
        pieces.append(sorted(piece))
        for c in piece:
            if c in unassigned:
                unassigned.remove(c)
    return pieces

def greedy_partition_balanced(grid, min_size=1, max_size=4):
    pieces = greedy_partition_basic(grid, min_size, max_size)
    M, N = len(grid), len(grid[0])
    cell_map = {}
    for idx, piece in enumerate(pieces):
        for cell in piece:
            cell_map[cell] = idx
    changed = True
    while changed:
        changed = False
        for i, piece in enumerate(list(pieces)):
            if len(piece) < min_size:
                found = False
                for r, c in piece:
                    for n in neighbors((r,c), M, N):
                        if n in cell_map and cell_map[n] != i:
                            j = cell_map[n]
                            pieces[i].extend(pieces[j])
                            for cell in pieces[j]:
                                cell_map[cell] = i
                            pieces[j] = []
                            found = True
                            changed = True
                            break
                    if found:
                        break
    pieces = [p for p in pieces if len(p) > 0]
    return pieces

def smart_partition(grid, min_size=2, max_size=4, attempts_per_cell=50):
    M, N = len(grid), len(grid[0])
    unassigned = {(r,c) for r in range(M) for c in range(N) if grid[r][c] == 1 or grid[r][c] == -1}
    pieces = []
    while unassigned:
        seed = max(unassigned, key=lambda x: sum((nbr in unassigned) for nbr in neighbors(x, M, N)))
        target_size = (min_size + max_size) // 2
        piece = {seed}
        frontier = [seed]
        attempts = 0
        while len(piece) < target_size and frontier and attempts < attempts_per_cell:
            cell = random.choice(frontier)
            nbrs = [n for n in neighbors(cell, M, N) if n in unassigned and n not in piece]
            if not nbrs:
                frontier.remove(cell)
                continue
            newcell = min(nbrs, key=lambda x: sum((nbr in unassigned and nbr not in piece) for nbr in neighbors(x, M, N)))
            piece.add(newcell)
            frontier.append(newcell)
            attempts += 1
        if len(piece) < min_size:
            added = True
            while len(piece) < min_size and added:
                added = False
                for r,c in list(piece):
                    for n in neighbors((r,c), M, N):
                        if n in unassigned and n not in piece:
                            piece.add(n)
                            added = True
                            if len(piece) >= min_size:
                                break
                    if len(piece) >= min_size:
                        break
        pieces.append(sorted(piece))
        for c in piece:
            if c in unassigned:
                unassigned.remove(c)
    return pieces

# =============================
# VARIANTES
# =============================
def normalize_piece(piece):
    min_r = min(r for r,c in piece)
    min_c = min(c for r,c in piece)
    return tuple(sorted([(r-min_r, c-min_c) for r,c in piece]))

def rotate_piece(piece):
    max_r = max(r for r,c in piece)
    return normalize_piece([(c, max_r-r) for r,c in piece])

def reflect_piece(piece):
    max_c = max(c for r,c in piece)
    return normalize_piece([(r, max_c-c) for r,c in piece])

def generate_variants(piece):
    variants = set()
    current = normalize_piece(piece)
    for _ in range(4):
        current = rotate_piece(current)
        variants.add(tuple(current))
        variants.add(tuple(reflect_piece(current)))
    return [list(v) for v in variants]

def canonical_forms(piece):
    variants = generate_variants(piece)
    normalized = [tuple(sorted(v)) for v in variants]
    return min(normalized)

def group_identical_pieces(pieces):
    groups_map = {}
    for idx, p in enumerate(pieces):
        key = canonical_forms(p)
        groups_map.setdefault(key, []).append(idx)
    return list(groups_map.values()), list(groups_map.keys())

# =============================
# SOLUCIONES
# =============================
def find_solutions_unique(grid, pieces, max_solutions=None):
    M, N = len(grid), len(grid[0])
    cells_to_cover = {(r,c) for r in range(M) for c in range(N) if grid[r][c] != 0}
    solutions = []

    groups, _ = group_identical_pieces(pieces)
    group_counts = [len(g) for g in groups]

    group_placements = []
    for g in groups:
        rep_idx = g[0]
        piece = pieces[rep_idx]
        rel = normalize_piece(piece)
        variants = generate_variants(rel)
        placements_set = set()
        for var in variants:
            max_r = max(r for r,c in var)
            max_c = max(c for r,c in var)
            for r_shift in range(0, M - max_r):
                for c_shift in range(0, N - max_c):
                    shifted = frozenset({(r+r_shift, c+c_shift) for r,c in var})
                    if shifted <= cells_to_cover:
                        placements_set.add(shifted)
        placements = sorted(list(placements_set), key=lambda s: (min(s), len(s)))
        group_placements.append(placements)

    n_groups = len(groups)
    solution_by_original = [None] * len(pieces)

    def backtrack_group(idx_group, covered):
        if max_solutions is not None and len(solutions) >= max_solutions:
            return
        if idx_group >= n_groups:
            if covered == cells_to_cover:
                solutions.append([frozenset(s) for s in solution_by_original])
            return

        placements = group_placements[idx_group]
        g = groups[idx_group]
        k = len(g)
        if k == 0:
            backtrack_group(idx_group+1, covered)
            return

        chosen = []
        def place_in_group(start_idx, placed_count, covered_so_far):
            if max_solutions is not None and len(solutions) >= max_solutions:
                return
            if placed_count == k:
                for j, orig_idx in enumerate(sorted(g)):
                    solution_by_original[orig_idx] = chosen[j]
                backtrack_group(idx_group+1, covered_so_far)
                for orig_idx in g:
                    solution_by_original[orig_idx] = None
                return
            if start_idx >= len(placements):
                return
            for p_idx in range(start_idx, len(placements)):
                pl = placements[p_idx]
                if pl & covered_so_far:
                    continue
                chosen.append(pl)
                place_in_group(p_idx + 1, placed_count + 1, covered_so_far | pl)
                chosen.pop()
                if max_solutions is not None and len(solutions) >= max_solutions:
                    return

        place_in_group(0, 0, covered)

    backtrack_group(0, frozenset())
    return solutions

# =============================
# STL GENERATION
# =============================
def cube_vertices_faces(x0, y0, z0, sx, sy, sz):
    v = np.array([
        [x0, y0, z0],
        [x0+sx, y0, z0],
        [x0+sx, y0+sy, z0],
        [x0, y0+sy, z0],
        [x0, y0, z0+sz],
        [x0+sx, y0, z0+sz],
        [x0+sx, y0+sy, z0+sz],
        [x0, y0+sy, z0+sz],
    ])
    f = np.array([
        [0, 3, 1], [1, 3, 2],
        [4, 5, 7], [5, 6, 7],
        [0, 1, 4], [1, 5, 4],
        [1, 2, 5], [2, 6, 5],
        [2, 3, 6], [3, 7, 6],
        [3, 0, 7], [0, 4, 7],
    ], dtype=int)
    return v, f

def generate_stl_from_pieces(pieces, cube_size=STL_CUBE_SIZE, height=STL_HEIGHT,
                            gap_mm=STL_GAP_MM, tolerance_mm=STL_TOL_MM):
    if not _HAVE_NUMPY_STL:
        raise RuntimeError("numpy-stl no está instalado.")

    verts_all = []
    faces_all = []
    vert_offset = 0

    total = len(pieces)
    cols = 3
    rows = math.ceil(total / cols)

    max_w_cells = max((max(c for r, c in piece) - min(c for r, c in piece) + 1) for piece in pieces)
    max_h_cells = max((max(r for r, c in piece) - min(r for r, c in piece) + 1) for piece in pieces)

    stride_x = max_w_cells * cube_size + gap_mm
    stride_y = max_h_cells * cube_size + gap_mm

    for idx, piece in enumerate(pieces):
        col = idx % cols
        row = idx // cols
        base_x = col * stride_x
        base_y = row * stride_y

        min_r = min(r for r, c in piece)
        min_c = min(c for r, c in piece)
        piece_set = set(piece)

        for r, c in piece:
            x = base_x + (c - min_c) * cube_size + tolerance_mm/2
            y = base_y + (r - min_r) * cube_size + tolerance_mm/2
            v, f = cube_vertices_faces(x, y, 0, cube_size - tolerance_mm, cube_size - tolerance_mm, height)
            f += vert_offset
            verts_all.append(v)
            faces_all.append(f)
            vert_offset += v.shape[0]

            if (r, c+1) in piece_set:
                bx = base_x + (c - min_c + 1) * cube_size - tolerance_mm/2
                by = base_y + (r - min_r) * cube_size + tolerance_mm/2
                v, f = cube_vertices_faces(bx, by, 0, tolerance_mm, cube_size - tolerance_mm, height)
                f += vert_offset
                verts_all.append(v)
                faces_all.append(f)
                vert_offset += v.shape[0]
            if (r+1, c) in piece_set:
                bx = base_x + (c - min_c) * cube_size + tolerance_mm/2
                by = base_y + (r - min_r + 1) * cube_size - tolerance_mm/2
                v, f = cube_vertices_faces(bx, by, 0, cube_size - tolerance_mm, tolerance_mm, height)
                f += vert_offset
                verts_all.append(v)
                faces_all.append(f)
                vert_offset += v.shape[0]

            if ((r, c+1) in piece_set and (r+1, c) in piece_set and (r+1, c+1) in piece_set):
                cx = base_x + (c - min_c) * cube_size + (cube_size - tolerance_mm/2)
                cy = base_y + (r - min_r) * cube_size + (cube_size - tolerance_mm/2)
                v, f = cube_vertices_faces(cx, cy, 0, tolerance_mm, tolerance_mm, height)
                f += vert_offset
                verts_all.append(v)
                faces_all.append(f)
                vert_offset += v.shape[0]

    verts_all = np.vstack(verts_all)
    faces_all = np.vstack(faces_all)

    total_faces = faces_all.shape[0]
    puzzle_mesh = mesh.Mesh(np.zeros(total_faces, dtype=mesh.Mesh.dtype))
    for i, face in enumerate(faces_all):
        for j in range(3):
            puzzle_mesh.vectors[i][j] = verts_all[face[j], :]

    height = verts_all[:, 1].max()
    puzzle_mesh.vectors[:, :, 1] = height - puzzle_mesh.vectors[:, :, 1]

    return puzzle_mesh

def generate_base_scene(grid, cube_size=STL_CUBE_SIZE, border=5.0, base_thickness=3.0, wall_height=5.0):
    """Genera una escena trimesh con la base (placa + paredes)."""
    if not _HAVE_TRIMESH:
        raise RuntimeError("trimesh no está instalado.")

    import trimesh
    from trimesh import Scene
    
    M, N = len(grid), len(grid[0])
    base_width = N * cube_size + 2 * border
    base_length = M * cube_size + 2 * border

    verts_all = []
    faces_all = []
    vert_offset = 0

    # Base (placa inferior)
    v, f = cube_vertices_faces(0, 0, 0, base_width, base_length, base_thickness)
    f += vert_offset
    verts_all.append(v)
    faces_all.append(f)
    vert_offset += v.shape[0]

    # Paredes perimetrales completas (cubren esquinas)
    # Izquierda
    v, f = cube_vertices_faces(0, 0, base_thickness, border, base_length, wall_height)
    f += vert_offset
    verts_all.append(v)
    faces_all.append(f)
    vert_offset += v.shape[0]

    # Derecha
    v, f = cube_vertices_faces(base_width - border, 0, base_thickness, border, base_length, wall_height)
    f += vert_offset
    verts_all.append(v)
    faces_all.append(f)
    vert_offset += v.shape[0]

    # Frontal
    v, f = cube_vertices_faces(border, 0, base_thickness, base_width - 2 * border, border, wall_height)
    f += vert_offset
    verts_all.append(v)
    faces_all.append(f)
    vert_offset += v.shape[0]

    # Trasera
    v, f = cube_vertices_faces(border, base_length - border, base_thickness, base_width - 2 * border, border, wall_height)
    f += vert_offset
    verts_all.append(v)
    faces_all.append(f)
    vert_offset += v.shape[0]

    # Bloques internos rellenos según grid (celdas bloqueadas = 0)
    for r in range(M):
        for c in range(N):
            if grid[r][c] == 0:
                x = border + c * cube_size
                y = border + r * cube_size
                z = base_thickness
                v, f = cube_vertices_faces(x, y, z, cube_size, cube_size, wall_height)
                f += vert_offset
                verts_all.append(v)
                faces_all.append(f)
                vert_offset += v.shape[0]

    verts = np.vstack(verts_all)
    faces = np.vstack(faces_all)
    
    base_mesh = trimesh.Trimesh(vertices=verts, faces=faces)
    base_mesh.name = 'Base'
    
    scene = Scene([base_mesh])
    return scene

def generate_stl_base(grid, cube_size=STL_CUBE_SIZE, border=5.0, base_thickness=3.0, wall_height=5.0):
    if not _HAVE_NUMPY_STL:
        raise RuntimeError("numpy-stl no está instalado.")

    M, N = len(grid), len(grid[0])

    verts_all = []
    faces_all = []
    vert_offset = 0

    width = N * cube_size + 2*border
    height = M * cube_size + 2*border
    v, f = cube_vertices_faces(0, 0, 0, width, height, base_thickness)
    verts_all.append(v)
    faces_all.append(f + vert_offset)
    vert_offset += v.shape[0]

    for x0, y0, sx, sy in [(0, 0, border, height), (width-border, 0, border, height),
                           (border, 0, width-2*border, border), (border, height-border, width-2*border, border)]:
        v, f = cube_vertices_faces(x0, y0, base_thickness, sx, sy, wall_height)
        verts_all.append(v)
        faces_all.append(f + vert_offset)
        vert_offset += v.shape[0]

    for r in range(M):
        for c in range(N):
            if grid[r][c] == 0:
                x = border + c*cube_size
                y = border + r*cube_size
                z = base_thickness
                v, f = cube_vertices_faces(x, y, z, cube_size, cube_size, wall_height)
                verts_all.append(v)
                faces_all.append(f + vert_offset)
                vert_offset += v.shape[0]

    verts_all = np.vstack(verts_all)
    faces_all = np.vstack(faces_all)
    total_faces = faces_all.shape[0]
    base_mesh = mesh.Mesh(np.zeros(total_faces, dtype=mesh.Mesh.dtype))
    for i, face in enumerate(faces_all):
        for j in range(3):
            base_mesh.vectors[i][j] = verts_all[face[j], :]

    height = verts_all[:, 1].max()
    base_mesh.vectors[:, :, 1] = height - base_mesh.vectors[:, :, 1]

    return base_mesh

# =============================
# RUTAS
# =============================
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/health')
def health():
    return jsonify({'status': 'ok'}), 200

@app.route('/api/generate', methods=['POST'])
def api_generate():
    try:
        data = request.json
        M = int(data.get('M', DEFAULT_M))
        N = int(data.get('N', DEFAULT_N))
        min_size = int(data.get('min_size', DEFAULT_MIN_PIECE_SIZE))
        max_size = int(data.get('max_size', DEFAULT_MAX_PIECE_SIZE))
        border_prob = float(data.get('border_prob', DEFAULT_BORDER_PROB))
        air_prob = float(data.get('air_prob', DEFAULT_AIR_PROB))
        mode = data.get('mode', DEFAULT_MODE)

        # Generar grid
        grid = [[1 for _ in range(N)] for _ in range(M)]
        for r in range(M):
            for c in range(N):
                if r in (0, M-1) or c in (0, N-1):
                    if random.random() < border_prob:
                        grid[r][c] = 0
        
        corners = [(0,0),(0,N-1),(M-1,0),(M-1,N-1)]
        for r,c in corners:
            if grid[r][c] == 1:
                blocked_neighbors = 0
                for nr,nc in [(r+1,c),(r,c+1),(r-1,c),(r,c-1)]:
                    if 0 <= nr < M and 0 <= nc < N and grid[nr][nc] == 0:
                        blocked_neighbors += 1
                if blocked_neighbors >= 2:
                    grid[r][c] = 0
        
        for r in range(M):
            for c in range(N):
                if grid[r][c] == 1 and random.random() < air_prob:
                    grid[r][c] = -1

        # Generar piezas
        if mode == "Fast (original)":
            pieces = greedy_partition_basic(grid, min_size, max_size)
        elif mode == "Force minimum":
            pieces = greedy_partition_force_min(grid, min_size, max_size)
        elif mode == "Balanced":
            pieces = greedy_partition_balanced(grid, min_size, max_size)
        else:
            pieces = smart_partition(grid, min_size, max_size)

        # Guardar en sesión
        app.puzzle_data = {
            'grid': grid,
            'pieces': pieces,
            'solutions': []
        }

        return jsonify({
            'success': True,
            'grid': grid,
            'pieces': [[list(cell) for cell in piece] for piece in pieces],
            'piece_count': len(pieces)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/find_solutions', methods=['POST'])
def api_find_solutions():
    try:
        data = request.json
        max_solutions = int(data.get('max_solutions', 10))

        if not hasattr(app, 'puzzle_data') or not app.puzzle_data:
            return jsonify({'success': False, 'error': 'No puzzle generated'}), 400

        grid = app.puzzle_data['grid']
        pieces = app.puzzle_data['pieces']

        solutions = find_solutions_unique(grid, pieces, max_solutions=max_solutions)
        app.puzzle_data['solutions'] = solutions

        return jsonify({
            'success': True,
            'solutions_count': len(solutions)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# (3MF export route removed)

# =============================
# UNIVERSAL 3MF EXPORT (trimesh)
# =============================
# (3MF export removed)

def export_puzzle_to_stl(grid, pieces, cube_size=10.0, height=2.0, gap_mm=5.0, tolerance_mm=0.3, border=5.0, base_thickness=1.0, wall_height=2.0):
    """Genera un único STL con la base y las piezas, dispuestas igual que en 3MF.
    Se usa la misma disposición en galería a la derecha de la base.
    """
    if not _HAVE_TRIMESH:
        raise RuntimeError('trimesh no disponible para exportar STL')

    # Base con paredes
    M, N = len(grid), len(grid[0])
    base_w = N * cube_size + 2 * border
    # base_h = M * cube_size + 2 * border  # no necesario para layout
    base_scene = generate_base_scene(grid, cube_size=cube_size, border=border, base_thickness=base_thickness, wall_height=wall_height)
    base_mesh = list(base_scene.geometry.values())[0]

    # Piezas en galería
    piece_meshes = []
    total = len(pieces)
    cols = 3
    rows = math.ceil(total / cols) if total > 0 else 0

    if total > 0:
        max_w_cells = max((max(c for r, c in piece) - min(c for r, c in piece) + 1) for piece in pieces)
        max_h_cells = max((max(r for r, c in piece) - min(r for r, c in piece) + 1) for piece in pieces)
    else:
        max_w_cells = max_h_cells = 0

    stride_x = max_w_cells * cube_size + gap_mm
    stride_y = max_h_cells * cube_size + gap_mm
    gallery_offset_x = base_w + 20.0
    gallery_offset_y = 0.0

    for idx, piece in enumerate(pieces):
        col = idx % cols
        row = idx // cols
        base_x = gallery_offset_x + col * stride_x
        base_y = gallery_offset_y + row * stride_y

        min_r = min(cell[0] for cell in piece)
        min_c = min(cell[1] for cell in piece)
        piece_set = set(tuple(cell) for cell in piece)

        piece_verts = []
        piece_faces = []
        vert_offset = 0

        for r, c in piece:
            x = base_x + (c - min_c) * cube_size + tolerance_mm/2
            y = base_y + (r - min_r) * cube_size + tolerance_mm/2
            z = base_thickness
            v, f = cube_vertices_faces(x, y, z, cube_size - tolerance_mm, cube_size - tolerance_mm, height)
            f = f + vert_offset
            piece_verts.append(v)
            piece_faces.append(f)
            vert_offset += v.shape[0]

            if (r, c+1) in piece_set:
                bx = base_x + (c - min_c + 1) * cube_size - tolerance_mm/2
                by = base_y + (r - min_r) * cube_size + tolerance_mm/2
                v, f = cube_vertices_faces(bx, by, z, tolerance_mm, cube_size - tolerance_mm, height)
                f = f + vert_offset
                piece_verts.append(v)
                piece_faces.append(f)
                vert_offset += v.shape[0]
            if (r+1, c) in piece_set:
                bx = base_x + (c - min_c) * cube_size + tolerance_mm/2
                by = base_y + (r - min_r + 1) * cube_size - tolerance_mm/2
                v, f = cube_vertices_faces(bx, by, z, cube_size - tolerance_mm, tolerance_mm, height)
                f = f + vert_offset
                piece_verts.append(v)
                piece_faces.append(f)
                vert_offset += v.shape[0]

            if ((r, c+1) in piece_set and (r+1, c) in piece_set and (r+1, c+1) in piece_set):
                cx = base_x + (c - min_c) * cube_size + (cube_size - tolerance_mm/2)
                cy = base_y + (r - min_r) * cube_size + (cube_size - tolerance_mm/2)
                v, f = cube_vertices_faces(cx, cy, z, tolerance_mm, tolerance_mm, height)
                f = f + vert_offset
                piece_verts.append(v)
                piece_faces.append(f)
                vert_offset += v.shape[0]

        if piece_verts and piece_faces:
            verts = np.vstack(piece_verts)
            faces = np.vstack(piece_faces)
            piece_mesh = trimesh.Trimesh(vertices=verts, faces=faces)
            piece_meshes.append(piece_mesh)

    # Concatenar base + piezas en un solo mesh
    all_meshes = [base_mesh] + piece_meshes
    combined = trimesh.util.concatenate(all_meshes)
    # Centrar el conjunto en el origen (mantiene separaciones relativas)
    try:
        bmin, bmax = combined.bounds
        center = (bmin + bmax) / 2.0
        combined.apply_translation(-center)
    except Exception:
        pass
    # Exportar STL (ASCII o binario según la versión de Trimesh)
    stl_bytes = combined.export(file_type='stl')
    if isinstance(stl_bytes, str):
        stl_bytes = stl_bytes.encode('utf-8')
    return stl_bytes

@app.route('/api/export_stl', methods=['POST'])
def api_export_stl():
    try:
        data = request.get_json()
        if not hasattr(app, 'puzzle_data') or not app.puzzle_data:
            return jsonify({'success': False, 'error': 'No puzzle generated'}), 400
        cube_size = float(data.get('cube_size', STL_CUBE_SIZE))
        height = float(data.get('height', STL_HEIGHT))
        gap_mm = float(data.get('gap_mm', STL_GAP_MM))
        tolerance_mm = float(data.get('tolerance_mm', STL_TOL_MM))
        border = float(data.get('border', STL_BASE_BORDER_SIZE_MM))
        base_thickness = float(data.get('base_thickness', STL_BASE_THICKNESS_MM))
        wall_height = float(data.get('wall_height', STL_BASE_WALL_HEIGHT_MM))
        grid = app.puzzle_data['grid']
        pieces = app.puzzle_data['pieces']
        out_bytes = export_puzzle_to_stl(grid, pieces, cube_size, height, gap_mm, tolerance_mm, border, base_thickness, wall_height)
        file_bytes = io.BytesIO(out_bytes)
        file_bytes.seek(0)
        return send_file(file_bytes, mimetype='model/stl', as_attachment=True, download_name='puzzle_project.stl')
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# (3MF packaging removed)

# (Bambu/Orca project 3MF packaging removed)

# (Model settings config removed)

# (3MF XML model builder removed)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port)
