#!/usr/bin/env python3
"""Validate the exact IIS config shipped at the application root."""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def validate(path: Path) -> None:
    root = ET.parse(path).getroot()
    if root.tag != "configuration":
        raise ValueError("root element must be <configuration>")
    server = root.find("system.webServer")
    if server is None:
        raise ValueError("missing system.webServer")
    handlers = server.find("handlers")
    if handlers is None:
        raise ValueError("missing system.webServer/handlers")
    handler = handlers.find("add[@name='httpPlatformHandler']")
    if handler is None or any(handler.get(key) != value for key, value in {
        "path": "*", "verb": "*", "modules": "httpPlatformHandler"
    }.items()):
        raise ValueError("httpPlatformHandler must own all paths and verbs")
    platform = server.find("httpPlatform")
    if platform is None:
        raise ValueError("missing system.webServer/httpPlatform")
    expected = {
        "processPath": "node",
        "arguments": "sharkasp-bootstrap.mjs",
        "startupTimeLimit": "60",
        "startupRetryCount": "2",
        "processesPerApplication": "1",
    }
    if any(platform.get(key) != value for key, value in expected.items()):
        raise ValueError("httpPlatform launch settings do not match the IIS contract")
    env = platform.find("environmentVariables")
    if env is None:
        raise ValueError("missing httpPlatform/environmentVariables")
    variables = {item.get("name"): item.get("value") for item in env.findall("environmentVariable")}
    if variables != {
        "PORT": "%HTTP_PLATFORM_PORT%",
        "HOST": "127.0.0.1",
        "NODE_ENV": "production",
    }:
        raise ValueError("runtime variables do not match the IIS contract")
    if server.find("rewrite") is not None:
        raise ValueError("rewrite rules may intercept API or app routes")
    if not path.with_name("sharkasp-bootstrap.mjs").is_file():
        raise ValueError("configured startup file is missing beside web.config")


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "web.config")
    try:
        validate(target)
    except (ET.ParseError, OSError, ValueError) as error:
        print(f"SharkASP web.config validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
    print("SharkASP web.config: XML and IIS Node routing contract verified")
