"""Compile the two artwork ZIPs into the shared mobile and admin SVG registry."""

import json
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

FRONTEND = Path(__file__).resolve().parents[1]
ARCHIVES = FRONTEND / "assets" / "images"
REGISTRY = FRONTEND / "src" / "components" / "vector-symbols" / "generated-icons.json"
TAGS = {"circle", "ellipse", "g", "line", "path", "rect"}
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}"


def svg_name(node):
    return node.tag.removeprefix(SVG_NAMESPACE)


def shape(node):
    tag = svg_name(node)
    if tag not in TAGS:
        raise ValueError(f"Unsupported SVG element: {node.tag}")
    attributes = {}
    for name, value in node.attrib.items():
        parts = name.split("-")
        prop = parts[0] + "".join(part.capitalize() for part in parts[1:])
        if prop in {"fill", "stroke"} and value not in {"currentColor", "none"}:
            raise ValueError(f"Unexpected SVG paint: {value}")
        attributes[prop] = value
    children = [shape(child) for child in node]
    return [tag, attributes, children] if children else [tag, attributes]


def read_symbols(archive):
    symbols = {}
    with ZipFile(ARCHIVES / archive) as source:
        for member in sorted(source.namelist()):
            if not member.startswith("svg/") or not member.endswith(".svg"):
                continue
            name = Path(member).stem
            root = ElementTree.fromstring(source.read(member))
            if name in symbols or svg_name(root) != "svg" or root.get("viewBox") != "0 0 64 64":
                raise ValueError(f"Unexpected SVG in {archive}: {member}")
            nodes = [shape(node) for node in root if svg_name(node) != "title"]
            if not nodes:
                raise ValueError(f"Empty artwork in {archive}: {member}")
            symbols[name] = nodes
    return symbols


def render_section(name, symbols):
    entries = [
        f"    {json.dumps(symbol)}: {json.dumps(symbols[symbol], separators=(',', ':'))}"
        for symbol in sorted(symbols)
    ]
    return f'  "{name}": {{\n' + ",\n".join(entries) + "\n  }"


def main():
    customer = read_symbols("TrackMyRMC-Customer-Vector-Symbols.zip")
    operations = read_symbols("TrackMyRMC-Non-Customer-Vector-Symbols.zip")
    symbols = {**customer, **operations}
    overrides = {
        name: nodes for name, nodes in customer.items()
        if name in operations and operations[name] != nodes
    }
    sections = [render_section("symbols", symbols), render_section("customerOverrides", overrides)]
    REGISTRY.write_text("{\n" + ",\n".join(sections) + "\n}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
