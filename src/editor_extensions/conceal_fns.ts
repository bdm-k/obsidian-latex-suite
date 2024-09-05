// Conceal functions

import { EditorSelection } from "@codemirror/state";
import { ConcealSpec } from "./conceal";
import { findMatchingBracket } from "src/utils/editor_utils";
import { EditorView } from "@codemirror/view";
import { getEquationBounds } from "src/utils/context";
import { syntaxTree } from "@codemirror/language";
import { livePreviewState } from "obsidian";
import { brackets, cmd_symbols, fractions, greek, map_sub, map_super, mathbb, mathscrcal, operators } from "./conceal_maps";


function escapeRegex(regex: string) {
	const escapeChars = ["\\", "(", ")", "+", "-", "[", "]", "{", "}"];

	for (const escapeChar of escapeChars) {
		regex = regex.replaceAll(escapeChar, "\\" + escapeChar);
	}

	return regex;
}

/**
 * gets the updated end index to include "\\limits" in the concealed text of some conceal match,
 * if said match is directly followed by "\\limits"
 *
 * @param eqn source text
 * @param end index of eqn corresponding to the end of a match to conceal
 * @returns the updated end index to conceal
 */
function getEndIncludingLimits(eqn: string, end: number): number {
	const LIMITS = "\\limits";
	if (eqn.substring(end, end + LIMITS.length) === LIMITS) {
		return end + LIMITS.length;
	}
	return end;
}

function selectionAndRangeOverlap(
	selection: EditorSelection,
	rangeFrom: number,
	rangeTo: number
) {
	for (const range of selection.ranges) {
		if ((range.from <= rangeTo) && (range.to) >= rangeFrom) {
			return true;
		}
	}

	return false;
}


function concealSymbols(eqn: string, prefix: string, suffix: string, symbolMap: {[key: string]: string}, className?: string, allowSucceedingLetters = true):ConcealSpec[] {
	const symbolNames = Object.keys(symbolMap);

	const regexStr = prefix + "(" + escapeRegex(symbolNames.join("|")) + ")" + suffix;
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const symbol = match[1];

		if (!allowSucceedingLetters) {
			// If the symbol match is succeeded by a letter (e.g. "pm" in "pmatrix" is succeeded by "a"), don't conceal

			const end = match.index + match[0].length;
			if (eqn.charAt(end).match(/[a-zA-Z]/)) {
				continue;
			}
		}

		const end = getEndIncludingLimits(eqn, match.index + match[0].length);

		concealSpecs.push({start: match.index, end: end, replacement: symbolMap[symbol], class: className});
	}

	return concealSpecs;
}

function concealModifier(eqn: string, modifier: string, combiningCharacter: string):ConcealSpec[] {

	const regexStr = ("\\\\" + modifier + "{([A-Za-z])}");
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const symbol = match[1];

		concealSpecs.push({start: match.index, end: match.index + match[0].length, replacement: symbol + combiningCharacter, class: "latex-suite-unicode"});
	}

	return concealSpecs;
}

function concealSupSub(eqn: string, superscript: boolean, symbolMap: {[key: string]:string}):ConcealSpec[] {

	const prefix = superscript ? "\\^" : "_";
	const regexStr = prefix + "{([A-Za-z0-9\\()\\[\\]/+-=<>':;\\\\ *]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];


	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {

		const exponent = match[1];
		const elementType = superscript ? "sup" : "sub";


		// Conceal super/subscript symbols as well
		const symbolNames = Object.keys(symbolMap);

		const symbolRegexStr = "\\\\(" + escapeRegex(symbolNames.join("|")) + ")";
		const symbolRegex = new RegExp(symbolRegexStr, "g");

		const replacement = exponent.replace(symbolRegex, (a, b) => {
			return symbolMap[b];
		});


		concealSpecs.push({start: match.index, end: match.index + match[0].length, replacement: replacement, class: "cm-number", elementType: elementType});
	}

	return concealSpecs;
}

function concealModified_A_to_Z_0_to_9(eqn: string, mathBBsymbolMap: {[key: string]:string}):ConcealSpec[] {

	const regexStr = "\\\\(mathbf|boldsymbol|underline|mathrm|text|mathbb){([A-Za-z0-9 ]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const type = match[1];
		const value = match[2];

		const start = match.index;
		const end = start + match[0].length;

		if (type === "mathbf" || type === "boldsymbol") {
			concealSpecs.push({start: start, end: end, replacement: value, class: "cm-concealed-bold"});
		}
		else if (type === "underline") {
			concealSpecs.push({start: start, end: end, replacement: value, class: "cm-concealed-underline"});
		}
		else if (type === "mathrm") {
			concealSpecs.push({start: start, end: end, replacement: value, class: "cm-concealed-mathrm"});
		}
		else if (type === "text") {
			// Conceal _\text{}
			if (start > 0 && eqn.charAt(start - 1) === "_") {
				concealSpecs.push({start: start - 1, end: end, replacement: value, class: "cm-concealed-mathrm", elementType: "sub"});
			}
		}
		else if (type === "mathbb") {
			const letters = Array.from(value);
			const replacement = letters.map(el => mathBBsymbolMap[el]).join("");
			concealSpecs.push({start: start, end: end, replacement: replacement});
		}

	}

	return concealSpecs;
}

function concealModifiedGreekLetters(eqn: string, greekSymbolMap: {[key: string]:string}):ConcealSpec[] {

	const greekSymbolNames = Object.keys(greekSymbolMap);
	const regexStr = "\\\\(underline|boldsymbol){\\\\(" + escapeRegex(greekSymbolNames.join("|"))  + ")}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const type = match[1];
		const value = match[2];

		const start = match.index;
		const end = start + match[0].length;

		if (type === "underline") {
			concealSpecs.push({start: start, end: end, replacement: greekSymbolMap[value], class: "cm-concealed-underline"});
		}
		else if (type === "boldsymbol") {
			concealSpecs.push({start: start, end: end, replacement: greekSymbolMap[value], class: "cm-concealed-bold"});
		}
	}

	return concealSpecs;
}

function concealText(eqn: string):ConcealSpec[] {

	const regexStr = "\\\\text{([A-Za-z0-9-.!?() ]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const value = match[1];

		const start = match.index;
		const end = start + match[0].length;

		concealSpecs.push({start: start, end: end, replacement: value, class: "cm-concealed-mathrm cm-variable-2"});

	}

	return concealSpecs;
}

function concealOperators(eqn: string, symbols: string[]):ConcealSpec[] {

	const regexStr = "(\\\\(" + symbols.join("|") + "))([^a-zA-Z]|$)";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const value = match[2];

		const start = match.index;
		const end = getEndIncludingLimits(eqn, start + match[1].length);

		concealSpecs.push({start: start, end: end, replacement: value, class: "cm-concealed-mathrm cm-variable-2"});
	}

	return concealSpecs;
}

function concealAtoZ(eqn: string, prefix: string, suffix: string, symbolMap: {[key: string]: string}, className?: string):ConcealSpec[] {

	const regexStr = prefix + "([A-Z]+)" + suffix;
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const symbol = match[1];
		const letters = Array.from(symbol);
		const replacement = letters.map(el => symbolMap[el]).join("");

		concealSpecs.push({start: match.index, end: match.index + match[0].length, replacement: replacement, class: className});
	}

	return concealSpecs;
}

function concealBraKet(eqn: string, selection: EditorSelection, eqnStartBound: number, mousedown: boolean):ConcealSpec[] {
	const langle = "〈";
	const rangle = "〉";
	const vert = "|";

	const regexStr = "\\\\(braket|bra|ket){";
	const symbolRegex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(symbolRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const loc = match.index + match[0].length;
		const j = findMatchingBracket(eqn, loc-1, "{", "}", false);

		if (j === -1) continue;

		const start = match.index;
		const end = start + match[0].length;

		if (!mousedown) {
			if (selectionAndRangeOverlap(selection, eqnStartBound + start, eqnStartBound + end)) continue;
			if (selectionAndRangeOverlap(selection, eqnStartBound + j, eqnStartBound + j + 1)) continue;
		}


		const type = match[1];
		const left = type === "ket" ? vert : langle;
		const right = type === "bra" ? vert : rangle;


		concealSpecs.push({start: start, end: end - 1, replacement: ""});
		concealSpecs.push({start: end - 1, end: end, replacement: left, class: "cm-bracket"});
		concealSpecs.push({start: j, end: j + 1, replacement: right, class: "cm-bracket"});
	}

	return concealSpecs;
}

function concealSet(eqn: string, selection: EditorSelection, eqnStartBound: number, mousedown: boolean): ConcealSpec[] {

	const setRegex = /\\set\{/g;

	const matches = [...eqn.matchAll(setRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const start = match.index;
		const end = start + match[0].length;

		const loc = match.index + match[0].length;
		const j = findMatchingBracket(eqn, loc-1, "{", "}", false);
		if (j === -1) { continue; }

		if (!mousedown) {
			if (selectionAndRangeOverlap(selection, eqnStartBound + start, eqnStartBound + end)) { continue; }
			if (selectionAndRangeOverlap(selection, eqnStartBound + j, eqnStartBound + j + 1)) { continue; }
		}

		concealSpecs.push({start: start, end: end - 1, replacement: ""});
		concealSpecs.push({start: end - 1, end: end, replacement: "{", class: "cm-bracket"});
		concealSpecs.push({start: j, end: j + 1, replacement: "}", class: "cm-bracket"});
	}

	return concealSpecs;
}

function concealFraction(eqn: string, selection: EditorSelection, eqnStartBound: number, mousedown: boolean):ConcealSpec[] {

	const regexStr = "\\\\(frac){";
	const symbolRegex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(symbolRegex)];

	const concealSpecs: ConcealSpec[] = [];

	for (const match of matches) {
		const loc = match.index + match[0].length;
		const j = findMatchingBracket(eqn, loc-1, "{", "}", false);
		if (j === -1) continue;

		const charAfterFirstBracket = eqn.charAt(j+1);
		if (charAfterFirstBracket != "{") continue;
		const k = findMatchingBracket(eqn, j+1, "{", "}", false);
		if (k === -1) continue;

		const start = match.index;
		const end = start + match[0].length;

		if (!mousedown) {
			if (selectionAndRangeOverlap(selection, eqnStartBound + start, eqnStartBound + end)) continue;
			if (selectionAndRangeOverlap(selection, eqnStartBound + j, eqnStartBound + j + 2)) continue;
			if (selectionAndRangeOverlap(selection, eqnStartBound + k, eqnStartBound + k + 1)) continue;
		}


		concealSpecs.push({start: start, end: end - 1, replacement: ""});
		concealSpecs.push({start: end - 1, end: end, replacement: "(", class: "cm-bracket"});
		concealSpecs.push({start: j, end: j + 1, replacement: ")", class: "cm-bracket"});
		concealSpecs.push({start: j + 1, end: j + 1, replacement: "/", class: "cm-bracket"});
		concealSpecs.push({start: j + 1, end: j + 2, replacement: "(", class: "cm-bracket"});
		concealSpecs.push({start: k, end: k + 1, replacement: ")", class: "cm-bracket"});
	}

	return concealSpecs;
}

export function conceal(view: EditorView): ConcealSpec[] {
	const concealSpecs: ConcealSpec[] = [];

	const selection = view.state.selection;
	const mousedown = view.plugin(livePreviewState)?.mousedown;


	for (const { from, to } of view.visibleRanges) {

		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				const type = node.type;
				const to = node.to;

				if (!(type.name.contains("begin") && type.name.contains("math"))) {
					return;
				}

				const bounds = getEquationBounds(view.state, to);
				if (!bounds) return;


				const eqn = view.state.doc.sliceString(bounds.start, bounds.end);


				const ALL_SYMBOLS = {...greek, ...cmd_symbols};

				const localConcealSpecs = [
					...concealSymbols(eqn, "\\^", "", map_super),
					...concealSymbols(eqn, "_", "", map_sub),
					...concealSymbols(eqn, "\\\\frac", "", fractions),
					...concealSymbols(eqn, "\\\\", "", ALL_SYMBOLS, undefined, false),
					...concealSupSub(eqn, true, ALL_SYMBOLS),
					...concealSupSub(eqn, false, ALL_SYMBOLS),
					...concealModifier(eqn, "hat", "\u0302"),
					...concealModifier(eqn, "dot", "\u0307"),
					...concealModifier(eqn, "ddot", "\u0308"),
					...concealModifier(eqn, "overline", "\u0304"),
					...concealModifier(eqn, "bar", "\u0304"),
					...concealModifier(eqn, "tilde", "\u0303"),
					...concealModifier(eqn, "vec", "\u20D7"),
					...concealSymbols(eqn, "\\\\", "", brackets, "cm-bracket"),
					...concealAtoZ(eqn, "\\\\mathcal{", "}", mathscrcal),
					...concealModifiedGreekLetters(eqn, greek),
					...concealModified_A_to_Z_0_to_9(eqn, mathbb),
					...concealText(eqn),
					...concealBraKet(eqn, selection, bounds.start, mousedown),
					...concealSet(eqn, selection, bounds.start, mousedown),
					...concealFraction(eqn, selection, bounds.start, mousedown),
					...concealOperators(eqn, operators),
				];

				// Make the 'start' and 'end' fields represent positions in the entire
				// document (not in a math expression)
				for (const concealSpec of localConcealSpecs) {
					concealSpec.start += bounds.start;
					concealSpec.end += bounds.start;
				}

				concealSpecs.push(...localConcealSpecs);
			},
		});
	}
	return concealSpecs;
}
