"""
Blender headless smart mesh repair.
Chooses the best strategy based on mesh analysis.

Strategies (in escalation order):
  gentle    — remove duplicates + degenerates only
  fill      — merge close vertices + fix normals + fill holes
  boolean   — separate loose parts + boolean union

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender-smart-repair.py -- input.stl output.stl [strategy]

If strategy is omitted, auto-detects the best one.
If strategy is "auto", same behavior.
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
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(
        filepath=path,
        export_selected_objects=True,
        ascii_format=False,
    )


def analyze(obj):
    """Analyze mesh for non-manifold edges, boundary edges, and connected components."""
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    boundary = sum(1 for e in bm.edges if e.is_boundary)

    # Count connected components via flood fill over manifold edges
    visited = set()
    components = 0
    for f in bm.faces:
        if f.index in visited:
            continue
        components += 1
        stack = [f]
        while stack:
            cur = stack.pop()
            if cur.index in visited:
                continue
            visited.add(cur.index)
            for e in cur.edges:
                if e.is_manifold:  # only traverse manifold edges
                    for linked_f in e.link_faces:
                        if linked_f.index not in visited:
                            stack.append(linked_f)

    stats = {
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "non_manifold": non_manifold,
        "boundary": boundary,
        "components": components,
    }
    bm.free()
    bpy.ops.object.mode_set(mode='OBJECT')
    return stats


def choose_strategy(stats):
    """Choose repair strategy based on mesh analysis."""
    nm = stats["non_manifold"]
    bnd = stats["boundary"]
    comps = stats["components"]

    if nm == 0 and bnd == 0:
        return "none"

    if nm == 0 and bnd > 0:
        return "fill"

    if nm > 0 and comps > 5:
        return "boolean"

    if nm > 0 and comps <= 5:
        return "fill"

    return "fill"


def repair_gentle(input_path, output_path):
    """Remove duplicates and degenerates only."""
    obj = import_stl(input_path)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    export_stl(obj, output_path)
    return obj


def repair_fill(input_path, output_path):
    """Merge close vertices + fix normals + fill boundary holes."""
    obj = import_stl(input_path)
    bpy.ops.object.mode_set(mode='EDIT')

    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.mesh.normals_make_consistent(inside=False)

    # Fill boundary holes
    for _ in range(3):
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.mesh.select_non_manifold(
            extend=False, use_wire=False, use_boundary=True,
            use_multi_face=False, use_non_contiguous=False, use_verts=False,
        )
        bm = bmesh.from_edit_mesh(obj.data)
        has_boundary = any(e.select for e in bm.edges)
        bm.free()
        if not has_boundary:
            break
        try:
            bpy.ops.mesh.fill_holes(sides=64)
        except:
            break

    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    export_stl(obj, output_path)
    return obj


def repair_boolean(input_path, output_path):
    """Separate loose parts and boolean-union them back together."""
    obj = import_stl(input_path)

    # First clean up
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Separate by loose parts
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.mesh.separate(type='LOOSE')

    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    parts.sort(key=lambda o: len(o.data.polygons), reverse=True)

    if len(parts) < 2:
        export_stl(parts[0], output_path)
        return parts[0]

    # Boolean union: start with largest, union the rest
    base = parts[0]
    bpy.context.view_layer.objects.active = base
    base.select_set(True)

    failed = []
    for other in parts[1:]:
        mod = base.modifiers.new(name="Union", type='BOOLEAN')
        mod.operation = 'UNION'
        mod.object = other
        mod.solver = 'EXACT'
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(other, do_unlink=True)
        except:
            base.modifiers.remove(mod)
            failed.append(other)

    # Join any failed parts back in (better than losing them)
    if failed:
        for f in failed:
            f.select_set(True)
        base.select_set(True)
        bpy.context.view_layer.objects.active = base
        bpy.ops.object.join()

    # Final cleanup
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    export_stl(base, output_path)
    return base


STRATEGIES = {
    "gentle": repair_gentle,
    "fill": repair_fill,
    "boolean": repair_boolean,
}


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print("Usage: blender --background --python script.py -- input.stl output.stl [strategy]")
        sys.exit(1)

    input_path = argv[0]
    output_path = argv[1]
    requested_strategy = argv[2] if len(argv) > 2 else "auto"

    # Analyze
    obj = import_stl(input_path)
    before = analyze(obj)
    print(f"ANALYSIS:{json.dumps(before)}")

    # Choose strategy
    if requested_strategy == "auto":
        strategy = choose_strategy(before)
    else:
        strategy = requested_strategy

    if strategy == "none":
        print(f"STRATEGY:none")
        print(f"RESULT:{{\"strategy\":\"none\",\"before\":{json.dumps(before)},\"after\":{json.dumps(before)}}}")
        # Just copy the file
        import shutil
        shutil.copy2(input_path, output_path)
        sys.exit(0)

    print(f"STRATEGY:{strategy}")

    # Repair
    repair_fn = STRATEGIES.get(strategy, repair_fill)
    result_obj = repair_fn(input_path, output_path)

    # Re-analyze result
    result_obj2 = import_stl(output_path)
    after = analyze(result_obj2)

    result = {
        "strategy": strategy,
        "before": before,
        "after": after,
    }
    print(f"RESULT:{json.dumps(result)}")
