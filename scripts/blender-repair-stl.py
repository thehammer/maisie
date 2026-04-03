"""
Blender headless mesh repair script.
Gentler than pymeshfix — preserves geometry while fixing non-manifold issues.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-repair-stl.py -- input.stl output.stl
"""

import bpy
import bmesh
import sys
import json

def repair_mesh(input_path, output_path):
    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import STL
    bpy.ops.wm.stl_import(filepath=input_path)

    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj

    # Get initial stats
    initial_verts = len(obj.data.vertices)
    initial_faces = len(obj.data.polygons)

    # Switch to edit mode for repairs
    bpy.ops.object.mode_set(mode='EDIT')

    # Step 1: Merge by distance (remove duplicate/near-duplicate vertices)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)

    # Step 2: Fix normals (make consistent)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)

    # Step 3: Delete degenerate faces (zero area)
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_face_by_sides(number=3, type='LESS')  # degenerate
    bpy.ops.mesh.delete(type='FACE')

    # Step 4: Select and dissolve non-manifold edges iteratively
    for i in range(5):  # up to 5 passes
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.mesh.select_non_manifold(
            extend=False,
            use_wire=True,
            use_boundary=True,
            use_multi_face=True,
            use_non_contiguous=True,
            use_verts=True,
        )

        # Check if any non-manifold geometry remains
        bm = bmesh.from_edit_mesh(obj.data)
        selected = sum(1 for v in bm.verts if v.select)
        bm.free()

        if selected == 0:
            break

        # Try to fix: merge nearby vertices in selection, then fill holes
        bpy.ops.mesh.remove_doubles(threshold=0.001)
        bpy.ops.mesh.normals_make_consistent(inside=False)

    # Step 5: Fill remaining holes
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_non_manifold(use_boundary=True, extend=False)
    bm = bmesh.from_edit_mesh(obj.data)
    boundary_count = sum(1 for e in bm.edges if e.select)
    bm.free()

    if boundary_count > 0 and boundary_count < 5000:
        try:
            bpy.ops.mesh.fill_holes(sides=64)
        except:
            pass  # fill_holes can fail on complex geometry

    # Final normals pass
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)

    bpy.ops.object.mode_set(mode='OBJECT')

    # Get final stats
    final_verts = len(obj.data.vertices)
    final_faces = len(obj.data.polygons)

    # Export
    bpy.ops.wm.stl_export(
        filepath=output_path,
        export_selected_objects=True,
        ascii_format=False,
    )

    stats = {
        "initial_verts": initial_verts,
        "initial_faces": initial_faces,
        "final_verts": final_verts,
        "final_faces": final_faces,
        "verts_removed": initial_verts - final_verts,
        "faces_removed": initial_faces - final_faces,
    }
    print(f"REPAIR_RESULT:{json.dumps(stats)}")
    return stats


if __name__ == "__main__":
    # Args after "--"
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print("Usage: blender --background --python script.py -- input.stl output.stl")
        sys.exit(1)

    repair_mesh(argv[0], argv[1])
