import pytest

from llm_trajectory.scene.models import Position, Scene, SceneObject


@pytest.fixture
def sample_scene() -> Scene:
    return Scene(
        name="test_scene",
        objects=[
            SceneObject(name="Banana", position=Position(0.3, 0.1, 0.02), category="fruit", properties={"color": "yellow"}),
            SceneObject(name="Apple", position=Position(0.5, -0.2, 0.02), category="fruit", properties={"color": "red"}),
            SceneObject(name="Bowl", position=Position(0.7, 0.0, 0.0), category="container"),
        ],
    )
