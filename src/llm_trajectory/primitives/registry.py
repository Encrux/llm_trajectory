from __future__ import annotations

import inspect
from typing import Callable, get_type_hints

_REGISTRY: dict[str, Callable] = {}
_SCHEMAS: dict[str, dict] = {}

_TYPE_MAP = {
    str: "string",
    float: "number",
    int: "integer",
    bool: "boolean",
}


def primitive(fn: Callable) -> Callable:
    """Decorator that registers a handler and derives its tool schema from type hints."""
    name = fn.__name__
    _REGISTRY[name] = fn

    hints = get_type_hints(fn)
    sig = inspect.signature(fn)

    properties = {}
    required = []
    for param_name, param in sig.parameters.items():
        if param_name == "scene":
            continue
        param_type = hints.get(param_name, str)
        json_type = _TYPE_MAP.get(param_type, "string")
        properties[param_name] = {"type": json_type}
        if param.default is inspect.Parameter.empty:
            required.append(param_name)

    _SCHEMAS[name] = {
        "name": name,
        "description": (fn.__doc__ or "").strip(),
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }

    return fn


def get_handler(name: str) -> Callable:
    if name not in _REGISTRY:
        available = list(_REGISTRY.keys())
        raise KeyError(f"Unknown primitive '{name}'. Available: {available}")
    return _REGISTRY[name]


def get_all_schemas() -> list[dict]:
    return list(_SCHEMAS.values())


def to_anthropic_tools() -> list[dict]:
    """Generate tool definitions in Anthropic's tool_use format."""
    return [
        {
            "name": s["name"],
            "description": s["description"],
            "input_schema": s["parameters"],
        }
        for s in _SCHEMAS.values()
    ]


def to_openai_tools() -> list[dict]:
    """Generate tool definitions in OpenAI's function calling format."""
    return [
        {
            "type": "function",
            "function": {
                "name": s["name"],
                "description": s["description"],
                "parameters": s["parameters"],
            },
        }
        for s in _SCHEMAS.values()
    ]


def registered_names() -> list[str]:
    return list(_REGISTRY.keys())
