import { Platform, Workspace, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNode, TreeCursor } from "@lezer/common";


export function replaceRange(view: EditorView, start: number, end: number, replacement: string) {
	view.dispatch({
		changes: {from: start, to: end, insert: replacement}
	});
}

export function iterateCM6(workspace: Workspace, callback: (editor: EditorView) => unknown) {
    workspace.iterateAllLeaves(leaf => {
        leaf?.view instanceof MarkdownView &&
        (leaf.view.editor as any)?.cm instanceof EditorView &&
        callback((leaf.view.editor as any).cm);
    });
}

export function getCharacterAtPos(view: EditorView, pos: number) {
	const doc = view.state.doc;

	return doc.slice(pos, pos+1).toString();
}


export function setCursor(view: EditorView, pos: number) {
	view.dispatch({
		selection: {anchor: pos, head: pos}
	});

	resetCursorBlink();
}


export function setSelection(view: EditorView, start: number, end: number) {
	view.dispatch({
		selection: {anchor: start, head: end}
	});

	resetCursorBlink();
}


export function setSelections(view: EditorView, sel: EditorSelection) {
	view.dispatch({
		selection: sel
	});

	resetCursorBlink();
}



export function resetCursorBlink() {
	if (Platform.isMobile) return;

	const cursorLayer = document.getElementsByClassName("cm-cursorLayer")[0] as HTMLElement;

	if (cursorLayer) {
		const curAnim = cursorLayer.style.animationName;
		cursorLayer.style.animationName = curAnim === "cm-blink" ? "cm-blink2" : "cm-blink";
	}
}


export function isWithinEquation(state: EditorState):boolean {
	const pos = state.selection.main.to - 1;
	const tree = syntaxTree(state);

	const token = tree.resolveInner(pos, 1).name;
	let withinEquation = token.contains("math");

	if (!withinEquation) {
		// Allows detection of math mode at beginning of a line

		const tokenLeft = tree.resolveInner(pos - 1, 1).name;
		const tokenRight = tree.resolveInner(pos + 1, 1).name;

		if (tokenLeft.contains("math") && tokenRight.contains("math")) {
			withinEquation = true;
		}
	}
	else if (token.contains("end")) {
			withinEquation = false;
	}

	return withinEquation;
}


export function isWithinInlineEquation(
	state: EditorState,
	pos: number = state.selection.main.from
): boolean {
	const result = getEquationBounds(state, pos);
	if (!result) return false;
	const end = result.end;

	// Check whether we're in inline math or a block eqn
	const inlineMath = state.doc.sliceString(end, end+2) != "$$";

	return inlineMath;
}


/**
 * Returns 0 if pos is not touching a $ that marks an inline equation
 * Returns n if pos+n is inside an equation
 *  */
export function isTouchingInlineEquation(state: EditorState, pos: number):number {
	const tree = syntaxTree(state);
	const prevToken = tree.resolveInner(pos-1, 1).name;
	const token = tree.resolveInner(pos, 1).name;
	const nextToken = tree.resolveInner(pos+1, 1).name;

	if (token.contains("math-end") && !(prevToken.contains("math-end")) && !(nextToken.contains("math-end"))) {
		return -1;
	}
	else if (!(token.contains("math-begin")) && nextToken.contains("math-begin")) {
		const nextNextToken = tree.resolveInner(pos+2, 1).name;

		if (!(nextNextToken.contains("math-begin"))) {
			return 1;
		}
	}

	return 0;
}


export class Bounds {
	start: number;
	end: number;
}

/**
 * Figures out where this equation starts and where it ends.
 *
 * **Note:** If you intend to use this directly, check out Context.getBounds instead, which caches and also takes care of codeblock languages which should behave like math mode.
 */
export function getEquationBounds(state: EditorState, pos: number = state.selection.main.from): Bounds {
	let text = state.doc.toString();

	// ignore \$
	text = text.replaceAll("\\$", "\\R");

	const left = text.lastIndexOf("$", pos-1);
	const right = text.indexOf("$", pos);

	if (left === -1 || right === -1) return;

	return {start: left + 1, end: right};
}


export function getEnclosingBracketsPos(view: EditorView, pos: number) {

	const result = getEquationBounds(view.state);
	if (!result) return -1;
	const {start, end} = result;
	const text = view.state.doc.sliceString(start, end);


	for (let i = pos-start; i > 0; i--) {
		let curChar = text.charAt(i);


		if ([")", "]", "}"].contains(curChar)) {
			const closeBracket = curChar;
			const openBracket = getOpenBracket(closeBracket);

			const j = findMatchingBracket(text, i, openBracket, closeBracket, true);

			if (j === -1) return -1;

			// Skip to the beginnning of the bracket
			i = j;
			curChar = text.charAt(i);
		}
		else {

			if (!["{", "(", "["].contains(curChar)) continue;

			const j = findMatchingBracket(text, i, curChar, getCloseBracket(curChar), false);
			if (j === -1) continue;

			return {left: i + start, right: j + start};

		}
	}

	return -1;
}



export function reverse(s: string){
	return s.split("").reverse().join("");
}


export function findMatchingBracket(text: string, start: number, openBracket: string, closeBracket: string, searchBackwards: boolean, end?: number):number {
	if (searchBackwards) {
		const reversedIndex = findMatchingBracket(reverse(text), text.length - (start + closeBracket.length), reverse(closeBracket), reverse(openBracket), false);

		if (reversedIndex === -1) return -1;

		return text.length - (reversedIndex + openBracket.length)
	}

	let brackets = 0;
	const stop = end ? end : text.length;

	for (let i = start; i < stop; i++) {
		if (text.slice(i, i + openBracket.length) === openBracket) {
			brackets++;
		}
		else if (text.slice(i, i + closeBracket.length) === closeBracket) {
			brackets--;

			if (brackets === 0) {
				return i;
			}
		}
	}

	return -1;
}


export function getOpenBracket(closeBracket: string) {
	const openBrackets:{[closeBracket: string]: string} = {")": "(", "]": "[", "}": "{"};

	return openBrackets[closeBracket];
}


export function getCloseBracket(openBracket: string) {
	const closeBrackets:{[openBracket: string]: string} = {"(": ")", "[": "]", "{": "}"};

	return closeBrackets[openBracket];
}


export function langIfWithinCodeblock(view: EditorView | EditorState): string | null {
	const state = view instanceof EditorView ? view.state : view;
	const tree = syntaxTree(state);

	const pos = state.selection.ranges[0].from;

	// check if we're in a codeblock atm at all
	// somehow only the -1 side is reliable, all other ones are sporadically active
	const inCodeblock = tree.resolveInner(pos, -1).name.contains("codeblock");
	if (!inCodeblock) {
		return null;
	}

	// locate the start of the block
	const cursor = tree.cursorAt(pos, -1);
	const codeblockBegin = escalateToToken(cursor, Direction.Backward, "HyperMD-codeblock_HyperMD-codeblock-begin");

	if (codeblockBegin == null) {
		console.warn("unable to locate start of the codeblock even though inside one");
		return "";
	}

	// extract the language
	// codeblocks may start and end with an arbitrary number of backticks
	const language = state.sliceDoc(codeblockBegin.from, codeblockBegin.to).replace(/`+/, "");

	return language;
}


/**
 * Figures out where this codeblock starts and where it ends.
 *
 * **Note:** If you intend to use this directly, check out Context.getBounds instead, which caches and also takes care of codeblock languages which should behave like math mode.
 */
export function getCodeblockBounds(state: EditorState, pos: number = state.selection.main.from): Bounds {
	const tree = syntaxTree(state);

	let cursor = tree.cursorAt(pos, -1);
	const blockBegin = escalateToToken(cursor, Direction.Backward, "HyperMD-codeblock-begin");

	cursor = tree.cursorAt(pos, -1);
	const blockEnd = escalateToToken(cursor, Direction.Forward, "HyperMD-codeblock-end");

	return { start: blockBegin.to + 1, end: blockEnd.from - 1 };
}

enum Direction {
	Backward,
	Forward,
}

/**
  * Searches for a token in siblings and parents, in only one direction.
  *
  * @param cursor: Where to start iteration
  * @param dir: In which direction to look for the target node
  * @param target: What substring the target node should have
  *
  * @returns The node found or null if none was found.
  */
function escalateToToken(cursor: TreeCursor, dir: Direction, target: string): SyntaxNode | null {
	while (
		(dir == Direction.Backward && cursor.prevSibling())
		|| (dir == Direction.Forward && cursor.nextSibling())
		|| cursor.parent()
	) {
		if (cursor.name.contains(target)) {
			return cursor.node;
		}
	}

	return null;
}
