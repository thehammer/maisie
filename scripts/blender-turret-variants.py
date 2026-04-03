"""
Generate multiple repair variants of the missile turret STL.
Each variant uses a different strategy.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-turret-variants.py -- input_dir
"""

import bpy
import bmesh
import sys
import os
import json


def import_stl(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=path)
    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj
    return obj


def export_stl(obj, path):
    # Deselect all, select only our object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(
        filepath=path,
        export_selected_objects=True,
        ascii_format=False,
    )
    v = len(obj.data.vertices)
    f = len(obj.data.polygons)
    print(f"  Exported: {v} verts, {f} faces → {os.path.basename(path)}")


def variant_boolean_union(input_path, output_path):
    """Boolean union with self — properly fuses overlapping shells."""
    obj = import_stl(input_path)

    # Separate by loose parts
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.mesh.separate(type='LOOSE')

    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    parts.sort(key=lambda o: len(o.data.polygons), reverse=True)
    print(f"  Separated into {len(parts)} parts")

    if len(parts) < 2:
        print("  Only 1 part, skipping boolean")
        export_stl(parts[0], output_path)
        return

    # Use the largest part as the base, boolean-union smaller parts into it
    base = parts[0]
    bpy.context.view_layer.objects.active = base

    for other in parts[1:]:
        mod = base.modifiers.new(name="Union", type='BOOLEAN')
        mod.operation = 'UNION'
        mod.object = other
        mod.solver = 'EXACT'
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            # Remove the other object after successful union
            bpy.data.objects.remove(other, do_unlink=True)
        except Exception as e:
            print(f"  Boolean failed for a part: {e}")
            base.modifiers.remove(mod)

    export_stl(base, output_path)


def variant_merge_close(input_path, output_path):
    """Merge vertices within 0.01mm, then recalculate normals."""
    obj = import_stl(input_path)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.01)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    export_stl(obj, output_path)


def variant_remesh_voxel(input_path, output_path):
    """Voxel remesh — creates a clean manifold mesh from a volume representation.
    Loses sharp edges but guarantees watertight output."""
    obj = import_stl(input_path)

    # Calculate appropriate voxel size based on bounding box
    dims = obj.dimensions
    min_dim = min(dims)
    voxel_size = min_dim / 80  # ~80 voxels across smallest dimension

    mod = obj.modifiers.new(name="Remesh", type='REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = max(voxel_size, 0.1)  # minimum 0.1mm
    mod.use_smooth_shade = False

    bpy.ops.object.modifier_apply(modifier=mod.name)
    export_stl(obj, output_path)


def variant_merge_and_fill(input_path, output_path):
    """Merge close vertices, fix normals, fill boundary holes."""
    obj = import_stl(input_path)
    bpy.ops.object.mode_set(mode='EDIT')

    # Merge close vertices
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)

    # Fix normals
    bpy.ops.mesh.normals_make_consistent(inside=False)

    # Fill boundary holes
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_non_manifold(
        extend=False, use_wire=False, use_boundary=True,
        use_multi_face=False, use_non_contiguous=False, use_verts=False,
    )
    try:
        bpy.ops.mesh.edge_face_add()  # bridge/fill selected boundary edges
    except:
        try:
            bpy.ops.mesh.fill()
        except:
            pass

    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)

    bpy.ops.object.mode_set(mode='OBJECT')
    export_stl(obj, output_path)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 1:
        print("Usage: blender --background --python script.py -- output_dir")
        sys.exit(1)

    out_dir = argv[0]
    input_stl = os.path.join(out_dir, "01_original.stl")

    variants = [
        ("02_merge_close", variant_merge_close,
         "Merge vertices within 0.01mm + fix normals"),
        ("03_merge_and_fill", variant_merge_and_fill,
         "Merge vertices + fix normals + fill boundary holes"),
        ("04_boolean_union", variant_boolean_union,
         "Separate loose parts then boolean-union them back together"),
        ("05_voxel_remesh", variant_remesh_voxel,
         "Voxel remesh — guaranteed watertight but loses sharp detail"),
    ]

    for name, func, desc in variants:
        out_path = os.path.join(out_dir, f"{name}.stl")
        print(f"\n=== {name}: {desc} ===")
        try:
            func(input_stl, out_path)
        except Exception as e:
            print(f"  FAILED: {e}")
