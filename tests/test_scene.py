from pathlib import Path

import pytest

from llm_trajectory.scene.loader import load_scene
from llm_trajectory.scene.models import Position, Scene, SceneObject


class TestPosition:
    def test_offset(self):
        pos = Position(1.0, 2.0, 3.0)
        result = pos.offset(0.1, -0.2, 0.5)
        assert result == Position(1.1, 1.8, 3.5)

    def test_to_dict(self):
        pos = Position(1.0, 2.0, 3.0)
        assert pos.to_dict() == {"x": 1.0, "y": 2.0, "z": 3.0}

    def test_frozen(self):
        pos = Position(1.0, 2.0, 3.0)
        with pytest.raises(AttributeError):
            pos.x = 5.0


class TestScene:
    def test_get_object(self, sample_scene: Scene):
        obj = sample_scene.get_object("Banana")
        assert obj.name == "Banana"
        assert obj.position == Position(0.3, 0.1, 0.02)

    def test_get_object_case_insensitive(self, sample_scene: Scene):
        obj = sample_scene.get_object("banana")
        assert obj.name == "Banana"

    def test_get_object_not_found(self, sample_scene: Scene):
        with pytest.raises(KeyError, match="Mango"):
            sample_scene.get_object("Mango")

    def test_get_objects_by_category(self, sample_scene: Scene):
        fruits = sample_scene.get_objects_by_category("fruit")
        assert len(fruits) == 2
        assert {o.name for o in fruits} == {"Banana", "Apple"}

    def test_object_names(self, sample_scene: Scene):
        assert sample_scene.object_names() == ["Banana", "Apple", "Bowl"]

    def test_describe(self, sample_scene: Scene):
        desc = sample_scene.describe()
        assert "Banana" in desc
        assert "fruit" in desc
        assert "container" in desc


class TestLoader:
    def test_load_scene(self):
        scene = load_scene(Path(__file__).parent.parent / "scenes" / "tabletop_fruit.yaml")
        assert scene.name == "tabletop_fruit"
        assert len(scene.objects) == 4
        assert scene.workspace_bounds is not None
        banana = scene.get_object("Banana")
        assert banana.position == Position(0.3, 0.1, 0.02)
        assert banana.category == "fruit"
