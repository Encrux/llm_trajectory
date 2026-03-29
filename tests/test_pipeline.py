from llm_trajectory.llm.mock import MockLLM
from llm_trajectory.pipeline import Pipeline
from llm_trajectory.scene.models import Scene


class TestPipeline:
    def test_mock_pick_pipeline(self, sample_scene: Scene):
        llm = MockLLM(scenario="pick")
        pipeline = Pipeline(llm=llm)
        trajectory = pipeline.run(sample_scene, "Pick up the banana")
        assert len(trajectory.waypoints) == 5
        assert trajectory.metadata["scene"] == "test_scene"
        assert trajectory.metadata["task"] == "Pick up the banana"

    def test_mock_place_pipeline(self, sample_scene: Scene):
        llm = MockLLM(scenario="place")
        pipeline = Pipeline(llm=llm)
        trajectory = pipeline.run(sample_scene, "Put the banana in the bowl")
        assert len(trajectory.waypoints) == 9

    def test_trajectory_has_metadata(self, sample_scene: Scene):
        llm = MockLLM(scenario="pick")
        pipeline = Pipeline(llm=llm)
        trajectory = pipeline.run(sample_scene, "Pick up the banana")
        assert "scene" in trajectory.metadata
        assert "task" in trajectory.metadata
        assert trajectory.metadata["num_steps"] == 5
