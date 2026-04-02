from __future__ import annotations

from llm_trajectory.primitives.registry import primitive
from llm_trajectory.scene.models import Scene
from llm_trajectory.resolver.trajectory import Waypoint


@primitive
def move_to_point(scene: Scene, point_name: str) -> Waypoint:
    """Move the end-effector to the named object's position."""
    obj = scene.get_object(point_name)
    return Waypoint(position=obj.position, label=f"move_to({point_name})")


@primitive
def move_to_point_offset(
    scene: Scene,
    point_name: str,
    x_offset: float,
    y_offset: float,
    z_offset: float,
) -> Waypoint:
    """Move to a position offset from the named object."""
    obj = scene.get_object(point_name)
    pos = obj.position.offset(x_offset, y_offset, z_offset)
    return Waypoint(position=pos, label=f"move_to_offset({point_name})")


@primitive
def open_gripper(scene: Scene) -> Waypoint:
    """Open the gripper to release an object."""
    return Waypoint(gripper="open", label="open_gripper")


@primitive
def close_gripper(scene: Scene) -> Waypoint:
    """Close the gripper to grasp an object."""
    return Waypoint(gripper="close", label="close_gripper")


@primitive
def wait(scene: Scene, seconds: float) -> Waypoint:
    """Pause execution for the specified duration."""
    return Waypoint(wait=seconds, label=f"wait({seconds})")
