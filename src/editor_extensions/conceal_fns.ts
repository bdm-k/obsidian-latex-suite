// Conceal functions

import { ConcealSpec, ConcealSpecList, iterConcealSpec } from "./conceal";
import { findMatchingBracket } from "src/utils/editor_utils";
import { EditorView } from "@codemirror/view";
import { getEquationBounds } from "src/utils/context";
import { syntaxTree } from "@codemirror/language";
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


function concealSymbols(eqn: string, prefix: string, suffix: string, symbolMap: {[key: string]: string}, className?: string, allowSucceedingLetters = true): ConcealSpecList {
	const symbolNames = Object.keys(symbolMap);

	const regexStr = prefix + "(" + escapeRegex(symbolNames.join("|")) + ")" + suffix;
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const lst: ConcealSpecList = [];

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

		lst.push({
			inner: {start: match.index, end: end, replacement: symbolMap[symbol], class: className}
		});
	}

	return lst;
}

function concealModifier(eqn: string, modifier: string, combiningCharacter: string): ConcealSpecList {

	const regexStr = ("\\\\" + modifier + "{([A-Za-z])}");
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const symbol = match[1];

		lst.push({
			inner: {start: match.index, end: match.index + match[0].length, replacement: symbol + combiningCharacter, class: "latex-suite-unicode"}
		});
	}

	return lst;
}

function concealSupSub(eqn: string, superscript: boolean, symbolMap: {[key: string]:string}): ConcealSpecList {

	const prefix = superscript ? "\\^" : "_";
	const regexStr = prefix + "{([A-Za-z0-9\\()\\[\\]/+-=<>':;\\\\ *]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];


	const lst: ConcealSpecList = [];

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


		lst.push({
			inner: {start: match.index, end: match.index + match[0].length, replacement: replacement, class: "cm-number", elementType: elementType}
		});
	}

	return lst;
}

function concealModified_A_to_Z_0_to_9(eqn: string, mathBBsymbolMap: {[key: string]:string}): ConcealSpecList {

	const regexStr = "\\\\(mathbf|boldsymbol|underline|mathrm|text|mathbb){([A-Za-z0-9 ]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const type = match[1];
		const value = match[2];

		const start = match.index;
		const end = start + match[0].length;

		if (type === "mathbf" || type === "boldsymbol") {
			lst.push({
				inner: {start: start, end: end, replacement: value, class: "cm-concealed-bold"}
			});
		}
		else if (type === "underline") {
			lst.push({
				inner: {start: start, end: end, replacement: value, class: "cm-concealed-underline"}
			});
		}
		else if (type === "mathrm") {
			lst.push({
				inner: {start: start, end: end, replacement: value, class: "cm-concealed-mathrm"}
			});
		}
		else if (type === "text") {
			// Conceal _\text{}
			if (start > 0 && eqn.charAt(start - 1) === "_") {
				lst.push({
					inner: {start: start - 1, end: end, replacement: value, class: "cm-concealed-mathrm", elementType: "sub"}
				});
			}
		}
		else if (type === "mathbb") {
			const letters = Array.from(value);
			const replacement = letters.map(el => mathBBsymbolMap[el]).join("");
			lst.push({
				inner: {start: start, end: end, replacement: replacement}
			});
		}

	}

	return lst;
}

function concealModifiedGreekLetters(eqn: string, greekSymbolMap: {[key: string]:string}): ConcealSpecList {

	const greekSymbolNames = Object.keys(greekSymbolMap);
	const regexStr = "\\\\(underline|boldsymbol){\\\\(" + escapeRegex(greekSymbolNames.join("|"))  + ")}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const type = match[1];
		const value = match[2];

		const start = match.index;
		const end = start + match[0].length;

		if (type === "underline") {
			lst.push({
				inner: {start: start, end: end, replacement: greekSymbolMap[value], class: "cm-concealed-underline"}
			});
		}
		else if (type === "boldsymbol") {
			lst.push({
				inner: {start: start, end: end, replacement: greekSymbolMap[value], class: "cm-concealed-bold"}
			});
		}
	}

	return lst;
}

function concealText(eqn: string): ConcealSpecList {

	const regexStr = "\\\\text{([A-Za-z0-9-.!?() ]+)}";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const value = match[1];

		const start = match.index;
		const end = start + match[0].length;

		lst.push({
			inner: {start: start, end: end, replacement: value, class: "cm-concealed-mathrm cm-variable-2"}
		});

	}

	return lst;
}

function concealOperators(eqn: string, symbols: string[]): ConcealSpecList {

	const regexStr = "(\\\\(" + symbols.join("|") + "))([^a-zA-Z]|$)";
	const regex = new RegExp(regexStr, "g");

	const matches = [...eqn.matchAll(regex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const value = match[2];

		const start = match.index;
		const end = getEndIncludingLimits(eqn, start + match[1].length);

		lst.push({
			inner: {start: start, end: end, replacement: value, class: "cm-concealed-mathrm cm-variable-2"}
		});
	}

	return lst;
}

function concealAtoZ(eqn: string, prefix: string, suffix: string, symbolMap: {[key: string]: string}, className?: string): ConcealSpecList {

	const regexStr = prefix + "([A-Z]+)" + suffix;
	const symbolRegex = new RegExp(regexStr, "g");


	const matches = [...eqn.matchAll(symbolRegex)];

	const lst: ConcealSpecList = [];

	for (const match of matches) {
		const symbol = match[1];
		const letters = Array.from(symbol);
		const replacement = letters.map(el => symbolMap[el]).join("");

		lst.push({
			inner: {start: match.index, end: match.index + match[0].length, replacement: replacement, class: className}
		});
	}

	return lst;
}

function concealBraKet(eqn: string): ConcealSpecList {
	const langle = "〈";
	const rangle = "〉";
	const vert = "|";

	const lst: ConcealSpecList = [];

	for (const match of eqn.matchAll(/\\(braket|bra|ket){/g)) {
		// index of the "}"
		const contentEnd = findMatchingBracket(eqn, match.index, "{", "}", false);
		if (contentEnd === -1) continue;

		const commandStart = match.index;
		// index of the "{"
		const contentStart = commandStart + match[0].length - 1;

		const type = match[1];
		const left = type === "ket" ? vert : langle;
		const right = type === "bra" ? vert : rangle;

		const concealSpec: ConcealSpec = [
			// Hide the command
			{ start: commandStart, end: contentStart, replacement: "" },
			// Replace the "{"
			{ start: contentStart, end: contentStart + 1, replacement: left, class: "cm-bracket" },
			// Replace the "}"
			{ start: contentEnd, end: contentEnd + 1, replacement: right, class: "cm-bracket" },
		];
		lst.push({ inner: concealSpec });
	}

	return lst;
}

function concealSet(eqn: string): ConcealSpecList {
	const lst: ConcealSpecList = [];

	for (const match of eqn.matchAll(/\\set\{/g)) {
		const commandStart = match.index;
		// index of the "{"
		const contentStart = commandStart + match[0].length - 1;

		// index of the "}"
		const contentEnd = findMatchingBracket(eqn, commandStart, "{", "}", false);
		if (contentEnd === -1) continue;

		const concealSpec: ConcealSpec = [
			// Hide "\set"
			{ start: commandStart, end: contentStart, replacement: "" },
			// Replace the "{"
			{ start: contentStart, end: contentStart + 1, replacement: "{", class: "cm-bracket" },
			// Replace the "}"
			{ start: contentEnd, end: contentEnd + 1, replacement: "}", class: "cm-bracket" },
		];
		lst.push({ inner: concealSpec });
	}

	return lst;
}

function concealFraction(eqn: string): ConcealSpecList {
	const lst: ConcealSpecList = [];

	for (const match of eqn.matchAll(/\\(frac){/g)) {
		// index of the closing bracket of the numerator
		const numeratorEnd = findMatchingBracket(eqn, match.index, "{", "}", false);
		if (numeratorEnd === -1) continue;

		// Expect there are no spaces between the closing bracket of the numerator
		// and the opening bracket of the denominator
		if (eqn.charAt(numeratorEnd + 1) !== "{") continue;

		// index of the closing bracket of the denominator
		const denominatorEnd = findMatchingBracket(eqn, numeratorEnd + 1, "{", "}", false);
		if (denominatorEnd === -1) continue;

		const commandStart = match.index;
		const numeratorStart = commandStart + match[0].length - 1;
		const denominatorStart = numeratorEnd + 1;

		const concealSpec: ConcealSpec = [
			// Hide "\frac"
			{ start: commandStart, end: numeratorStart, replacement: "" },
			// Replace brackets of the numerator
			{ start: numeratorStart, end: numeratorStart + 1, replacement: "(", class: "cm-bracket" },
			{ start: numeratorEnd, end: numeratorEnd + 1, replacement: ")", class: "cm-bracket"},
			// Add a slash
			{ start: numeratorEnd + 1, end: numeratorEnd + 1, replacement: "/", class: "cm-bracket" },
			// Replace brackets of the denominator
			{ start: denominatorStart, end: denominatorStart + 1, replacement: "(", class: "cm-bracket" },
			{ start: denominatorEnd, end: denominatorEnd + 1, replacement: ")", class: "cm-bracket" },
		];
		lst.push({ inner: concealSpec});
	}

	return lst;
}

export function conceal(view: EditorView): ConcealSpecList {
	const concealSpecList: ConcealSpecList = [];

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

				const lst = [
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
					...concealBraKet(eqn),
					...concealSet(eqn),
					...concealFraction(eqn),
					...concealOperators(eqn, operators),
				];

				// Make the 'start' and 'end' fields represent positions in the entire
				// document (not in a math expression)
				for (const wrapper of lst) {
					const concealSpec = wrapper.inner;
					iterConcealSpec(concealSpec, (singleSpec) => {
						singleSpec.start += bounds.start;
						singleSpec.end += bounds.start;
					});
				}

				concealSpecList.push(...lst);
			},
		});
	}

	return concealSpecList;
}
