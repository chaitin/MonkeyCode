import ace from "ace-builds/src-noconflict/ace";

const cssText = `

.ace-monkeycode .ace_gutter {
  background: #f8f8f8;
  color: #2e3440
}

.ace-monkeycode {
  background-color: #FFFFFF;
  color: #2e3440;
  line-height: 1.8 !important;
}

.ace-monkeycode .ace_cursor {
  color: #AEAFAD
}

.ace-monkeycode .ace_marker-layer .ace_selection {
  background: #e0e0e0
}

.ace-monkeycode.ace_multiselect .ace_selection.ace_start {
  box-shadow: 0 0 3px 0px #FFFFFF;
}

.ace-monkeycode .ace_marker-layer .ace_step {
  background: rgb(255, 255, 0)
}

.ace-monkeycode .ace_marker-layer .ace_bracket {
  margin: -1px 0 0 -1px;
  border: 1px solid #D1D1D1
}

.ace-monkeycode .ace_marker-layer .ace_active-line {
  background: #f4f4f4
}

.ace-monkeycode .ace_gutter-active-line {
  background-color : #f4f4f4
}

.ace-monkeycode .ace_marker-layer .ace_selected-word {
  border: 1px solid #e8e8e8
}

.ace-monkeycode .ace_invisible {
  color: #D1D1D1
}

.ace-monkeycode .ace_keyword,
.ace-monkeycode .ace_meta,
.ace-monkeycode .ace_storage,
.ace-monkeycode .ace_storage.ace_type,
.ace-monkeycode .ace_support.ace_type {
  color: #8959A8
}

.ace-monkeycode .ace_keyword.ace_operator {
  color: #3E999F
}

.ace-monkeycode .ace_constant.ace_character,
.ace-monkeycode .ace_constant.ace_language,
.ace-monkeycode .ace_constant.ace_numeric,
.ace-monkeycode .ace_keyword.ace_other.ace_unit,
.ace-monkeycode .ace_support.ace_constant,
.ace-monkeycode .ace_variable.ace_parameter {
  color: #F5871F
}

.ace-monkeycode .ace_constant.ace_other {
  color: #666969
}

.ace-monkeycode .ace_invalid {
  color: #FFFFFF;
  background-color: #C82829
}

.ace-monkeycode .ace_invalid.ace_deprecated {
  color: #FFFFFF;
  background-color: #8959A8
}

.ace-monkeycode .ace_fold {
  background-color: #4271AE;
  border-color: #2e3440
}

.ace-monkeycode .ace_entity.ace_name.ace_function,
.ace-monkeycode .ace_support.ace_function,
.ace-monkeycode .ace_variable {
  color: #C99E00
}

.ace-monkeycode .ace_support.ace_class,
.ace-monkeycode .ace_support.ace_type {
  color: #C99E00
}

.ace-monkeycode .ace_string {
  color: #5e81ac;
}

.ace-monkeycode .ace_markup {
  color: #8fbcbb !important;
}

.ace-monkeycode .ace_heading {
  color: #5e81ac;
  font-weight: bold;
}

.ace-monkeycode .ace_comment {
  color: #8E908C;
}
`;



ace.define(
    "ace/theme/monkeycode",
    ["require", "exports", "module", "ace/lib/dom"],
    function (require: any, exports: any) {
      exports.isDark = true;
      exports.cssClass = "ace-monkeycode";
      exports.cssText = cssText;
  
      const dom = require("ace/lib/dom");
      dom.importCssString(cssText, exports.cssClass);
    }
  );