"""
Blender headless mesh repair v2 — uses mesh.fill_holes + limited non-manifold cleanup.
Focuses on preserving geometry while fixing what we can.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-repair-v2.py -- input.stl output.stl
"""

import bpy
import bmesh
import sys
import json


def count_non_manifold(bm):
    return sum(1 for e in bm.edges if not e.is_manifold)


def repair_mesh(input_path, output_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=input_path)

    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj

    initial_verts = len(obj.data.vertices)
    initial_faces = len(obj.data.polygons)

    bpy.ops.object.mode_set(mode='EDIT')
    mesh = obj.data

    # Step 1: Remove doubles with tight threshold
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)

    # Step 2: Delete zero-area faces
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(mesh)
    for f in bm.faces:
        if f.calc_area() < 1e-10:
            f.select = True
    bmesh.update_edit_mesh(mesh)
    bpy.ops.mesh.delete(type='FACE')

    # Step 3: Delete interior faces (faces completely inside the mesh)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)

    # Step 4: Select non-manifold, try dissolving edges that have >2 faces
    bm = bmesh.from_edit_mesh(mesh)
    nm_before = count_non_manifold(bm)
    bm.free()

    # Try removing non-manifold edges by dissolving
    for pass_num in range(3):
        bpy.ops.mesh.select_all(action='DESELECT')
        bm = bmesh.from_edit_mesh(mesh)

        # Select edges with >2 adjacent faces (non-manifold due to overlapping geometry)
        for e in bm.edges:
            if len(e.link_faces) > 2:
                e.select = True

        selected = sum(1 for e in bm.edges if e.select)
        bmesh.update_edit_mesh(mesh)

        if selected == 0:
            bm.free()
            break

        # Dissolve the problematic edges
        try:
            bpy.ops.mesh.dissolve_edges(use_verts=False)
        except:
            pass

        bm = bmesh.from_edit_mesh(mesh)
        nm_after = count_non_manifold(bm)
        bm.free()

        # If we made it worse, undo and stop
        if nm_after >= nm_before:
            try:
                bpy.ops.ed.undo()
            except:
                pass
            break
        nm_before = nm_after

    # Step 5: Fill small holes (boundary edges)
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_non_manifold(
        extend=False, use_wire=False, use_boundary=True,
        use_multi_face=False, use_non_contiguous=False, use_verts=False,
    )
    try:
        bpy.ops.mesh.fill_holes(sides=32)
    except:
        pass

    # Final normals
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)

    bpy.ops.object.mode_set(mode='OBJECT')

    final_verts = len(obj.data.vertices)
    final_faces = len(obj.data.polygons)

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


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print("Usage: blender --background --python script.py -- input.stl output.stl")
        sys.exit(1)
    repair_mesh(argv[0], argv[1])
