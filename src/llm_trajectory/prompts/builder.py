from __future__ import annotations

from llm_trajectory.scene.models import Scene

SYSTEM_TEMPLATE = """You are a robot policy writer. Given a scene description and a task, you accomplish the task by calling the provided movement primitive tools in sequence.

Rules:
- Refer to objects by their exact name as listed in the scene.
- Do NOT use raw coordinates — the tools handle coordinate resolution.
- Call tools in the order they should be executed.
- Approach objects from above before moving to them (use move_to_point_offset with a positive z_offset first).
- Open the gripper before picking up an object.

{scene_description}

Task: {task}"""


class PromptBuilder:
    def __init__(self, scene: Scene):
        self.scene = scene

    def build(self, task: str) -> str:
        return SYSTEM_TEMPLATE.format(
            scene_description=self.scene.describe(),
            task=task,
        )
