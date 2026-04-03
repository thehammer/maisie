"""
Check and fix normals on an STL.
Reports normal direction and optionally flips/recalculates them.

Usage:
  blender --background --python script.py -- input.stl output.stl [action]

Actions:
  check      — just report (default)
  recalculate — recalculate normals (outside)
  flip       — flip all normals
  both       — flip then recalculate
"""

import bpy
import bmesh
import sys
import json


def import_stl(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=path)
    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj
    return obj


def check_normals(obj):
    """Check what percentage of normals point outward vs inward."""
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    # Calculate center of mass
    center = sum((f.calc_center_median() for f in bm.faces), bm.faces[0].calc_center_median() * 0)
    center /= len(bm.faces)

    outward = 0
    inward = 0
    for f in bm.faces:
        # Vector from center to face center
        to_face = f.calc_center_median() - center
        # Dot with face normal
        dot = to_face.dot(f.normal)
        if dot > 0:
            outward += 1
        else:
            inward += 1

    total = outward + inward
    bm.free()
    bpy.ops.object.mode_set(mode='OBJECT')

    return {
        "outward": outward,
        "inward": inward,
        "total": total,
        "outward_pct": round(outward / total * 100, 1) if total > 0 else 0,
        "inward_pct": round(inward / total * 100, 1) if total > 0 else 0,
        "likely_inverted": inward > outward,
    }


def recalculate_normals(obj):
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def flip_normals(obj):
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')


def export_stl(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, ascii_format=False)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 1:
        print("Usage: blender --background --python script.py -- input.stl [output.stl] [action]")
        sys.exit(1)

    input_path = argv[0]
    output_path = argv[1] if len(argv) > 1 else None
    action = argv[2] if len(argv) > 2 else "check"

    obj = import_stl(input_path)
    before = check_normals(obj)
    print(f"NORMALS_BEFORE:{json.dumps(before)}")

    if action == "check":
        sys.exit(0)

    # Re-import fresh for modification
    obj = import_stl(input_path)

    if action == "recalculate":
        recalculate_normals(obj)
    elif action == "flip":
        flip_normals(obj)
    elif action == "both":
        flip_normals(obj)
        recalculate_normals(obj)

    after = check_normals(obj)
    print(f"NORMALS_AFTER:{json.dumps(after)}")

    # Re-import and apply again for clean export
    obj = import_stl(input_path)
    if action == "recalculate":
        recalculate_normals(obj)
    elif action == "flip":
        flip_normals(obj)
    elif action == "both":
        flip_normals(obj)
        recalculate_normals(obj)

    if output_path:
        export_stl(obj, output_path)
        v = len(obj.data.vertices)
        f = len(obj.data.polygons)
        print(f"EXPORTED:{v} verts, {f} faces → {output_path}")
