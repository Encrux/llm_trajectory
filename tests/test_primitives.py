import pytest

from llm_trajectory.primitives import handlers as _  # noqa: F401 — trigger registration
from llm_trajectory.primitives.registry import (
    get_handler,
    registered_names,
    to_anthropic_tools,
    to_openai_tools,
)
from llm_trajectory.scene.models import Position, Scene


class TestRegistry:
    def test_all_primitives_registered(self):
        names = registered_names()
        assert "move_to_point" in names
        assert "move_to_point_offset" in names
        assert "open_gripper" in names
        assert "close_gripper" in names
        assert "wait" in names

    def test_get_handler_unknown(self):
        with pytest.raises(KeyError, match="fly_away"):
            get_handler("fly_away")


class TestAnthropicTools:
    def test_generates_valid_schemas(self):
        tools = to_anthropic_tools()
        assert len(tools) >= 5
        move = next(t for t in tools if t["name"] == "move_to_point")
        assert "input_schema" in move
        assert move["input_schema"]["properties"]["point_name"]["type"] == "string"
        assert "point_name" in move["input_schema"]["required"]

    def test_no_scene_param_in_schema(self):
        tools = to_anthropic_tools()
        for tool in tools:
            assert "scene" not in tool["input_schema"].get("properties", {})

    def test_gripper_has_no_params(self):
        tools = to_anthropic_tools()
        grip = next(t for t in tools if t["name"] == "open_gripper")
        assert grip["input_schema"]["properties"] == {}


class TestOpenAITools:
    def test_generates_valid_schemas(self):
        tools = to_openai_tools()
        assert len(tools) >= 5
        move = next(t for t in tools if t["function"]["name"] == "move_to_point")
        assert move["type"] == "function"
        params = move["function"]["parameters"]
        assert params["properties"]["point_name"]["type"] == "string"


class TestHandlers:
    def test_move_to_point(self, sample_scene: Scene):
        handler = get_handler("move_to_point")
        wp = handler(sample_scene, point_name="Banana")
        assert wp.position == Position(0.3, 0.1, 0.02)
        assert "Banana" in wp.label

    def test_move_to_point_offset(self, sample_scene: Scene):
        handler = get_handler("move_to_point_offset")
        wp = handler(sample_scene, point_name="Banana", x_offset=0.0, y_offset=0.0, z_offset=0.1)
        assert wp.position.x == pytest.approx(0.3)
        assert wp.position.y == pytest.approx(0.1)
        assert wp.position.z == pytest.approx(0.12)

    def test_open_gripper(self, sample_scene: Scene):
        handler = get_handler("open_gripper")
        wp = handler(sample_scene)
        assert wp.gripper == "open"
        assert wp.position is None

    def test_close_gripper(self, sample_scene: Scene):
        handler = get_handler("close_gripper")
        wp = handler(sample_scene)
        assert wp.gripper == "close"

    def test_wait(self, sample_scene: Scene):
        handler = get_handler("wait")
        wp = handler(sample_scene, seconds=2.5)
        assert wp.wait == 2.5

    def test_move_to_unknown_object(self, sample_scene: Scene):
        handler = get_handler("move_to_point")
        with pytest.raises(KeyError, match="Mango"):
            handler(sample_scene, point_name="Mango")
