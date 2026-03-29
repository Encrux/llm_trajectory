from __future__ import annotations

from pathlib import Path

import typer

app = typer.Typer(help="LLM-powered robot trajectory generation")


@app.command()
def generate(
    scene: Path = typer.Option(..., "--scene", "-s", help="Path to scene YAML file"),
    task: str = typer.Option(..., "--task", "-t", help="Task description"),
    llm: str = typer.Option("mock", "--llm", "-l", help="LLM backend: mock, claude, openai"),
    output: Path = typer.Option("trajectory.json", "--output", "-o", help="Output JSON path"),
    scenario: str = typer.Option("pick", "--scenario", help="Mock scenario: pick, place"),
    model: str = typer.Option(None, "--model", "-m", help="Model name override"),
) -> None:
    """Generate a robot trajectory from a scene and task description."""
    from llm_trajectory.backends.json_file import JsonFileBackend
    from llm_trajectory.pipeline import Pipeline
    from llm_trajectory.scene.loader import load_scene

    loaded_scene = load_scene(scene)

    if llm == "mock":
        from llm_trajectory.llm.mock import MockLLM
        backend = MockLLM(scenario=scenario)
        tool_format = "anthropic"
    elif llm == "claude":
        from llm_trajectory.llm.claude import ClaudeLLM
        backend = ClaudeLLM(model=model or "claude-sonnet-4-20250514")
        tool_format = "anthropic"
    elif llm == "openai":
        from llm_trajectory.llm.openai_backend import OpenAILLM
        backend = OpenAILLM(model=model or "gpt-4o")
        tool_format = "openai"
    else:
        typer.echo(f"Unknown LLM backend: {llm}", err=True)
        raise typer.Exit(1)

    pipeline = Pipeline(llm=backend, tool_format=tool_format)
    trajectory = pipeline.run(loaded_scene, task)

    output_backend = JsonFileBackend(output)
    output_backend.execute(trajectory)

    typer.echo(f"Generated {len(trajectory.waypoints)} waypoints -> {output}")
    typer.echo(trajectory.to_json())


if __name__ == "__main__":
    app()
