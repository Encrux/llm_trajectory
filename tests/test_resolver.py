import pytest

from llm_trajectory.primitives import handlers as _  # noqa: F401
from llm_trajectory.scene.models import Position, Scene
from llm_trajectory.resolver.resolver import ToolCall, resolve


class TestResolver:
    def test_single_move(self, sample_scene: Scene):
        calls = [ToolCall("move_to_point", {"point_name": "Banana"})]
        trajectory = resolve(calls, sample_scene)
        assert len(trajectory.waypoints) == 1
        assert trajectory.waypoints[0].position == Position(0.3, 0.1, 0.02)

    def test_pick_sequence(self, sample_scene: Scene):
        calls = [
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.1}),
            ToolCall("open_gripper", {}),
            ToolCall("move_to_point", {"point_name": "Banana"}),
            ToolCall("close_gripper", {}),
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.15}),
        ]
        trajectory = resolve(calls, sample_scene)
        assert len(trajectory.waypoints) == 5
        assert trajectory.waypoints[0].position.z == pytest.approx(0.12)
        assert trajectory.waypoints[1].gripper == "open"
        assert trajectory.waypoints[2].position == Position(0.3, 0.1, 0.02)
        assert trajectory.waypoints[3].gripper == "close"
        assert trajectory.waypoints[4].position.z == pytest.approx(0.17)

    def test_unknown_primitive_raises(self, sample_scene: Scene):
        calls = [ToolCall("fly_away", {})]
        with pytest.raises(KeyError, match="fly_away"):
            resolve(calls, sample_scene)

    def test_empty_calls(self, sample_scene: Scene):
        trajectory = resolve([], sample_scene)
        assert len(trajectory.waypoints) == 0

    def test_trajectory_to_json(self, sample_scene: Scene):
        calls = [
            ToolCall("move_to_point", {"point_name": "Bowl"}),
            ToolCall("open_gripper", {}),
        ]
        trajectory = resolve(calls, sample_scene)
        trajectory.metadata = {"scene": "test", "task": "test task"}
        json_str = trajectory.to_json()
        assert '"position"' in json_str
        assert '"gripper"' in json_str
        assert '"test task"' in json_str
