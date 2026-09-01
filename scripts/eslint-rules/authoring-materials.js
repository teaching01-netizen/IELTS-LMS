const RAW_FILL_PATTERN = /(?:^|\s)(?:bg|text|border|ring|from|via|to)-\[#/;
const BACKDROP_PATTERN = /(?:^|\s)backdrop-(?:blur|filter)(?:\s|$)/;
const APPROVED_MATERIAL_PATTERN = /(?:^|\s)(?:authoring-glass|authoring-sidebar[^\s]*|authoring-editor-footer|sat-rich-editor__toolbar)(?:\s|$)/;
const RAW_RGBA_PATTERN = /rgba\(/;

function inspect(value, context, node) {
  if (typeof value !== "string") return;
  if (RAW_FILL_PATTERN.test(value)) {
    context.report({ node, message: "Use an au-* semantic color token instead of a raw fill color." });
  }
  if (BACKDROP_PATTERN.test(value) && !APPROVED_MATERIAL_PATTERN.test(value)) {
    context.report({ node, message: "Use an approved authoring HUD/material class for translucency." });
  }
  if (RAW_RGBA_PATTERN.test(value) && !value.includes("shadow-[")) {
    context.report({ node, message: "Use a material or semantic token instead of raw rgba color." });
  }
}

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Keep SAT authoring color and material choices semantic." },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== "className" && node.name.name !== "style") return;
        const value = node.value;
        if (!value) return;
        if (value.type === "Literal") inspect(value.value, context, value);
        if (value.type === "JSXExpressionContainer" && value.expression.type === "Literal") {
          inspect(value.expression.value, context, value.expression);
        }
        if (value.type === "JSXExpressionContainer" && value.expression.type === "TemplateLiteral") {
          for (const quasi of value.expression.quasis) inspect(quasi.value.raw, context, quasi);
        }
      },
    };
  },
};
