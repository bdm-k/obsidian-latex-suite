// https://discuss.codemirror.net/t/concealing-syntax/3135

import { EditorView, ViewUpdate, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { EditorSelection, Range, StateEffect, StateField } from "@codemirror/state";
import { conceal } from "./conceal_fns";
import { livePreviewState } from "obsidian";

export interface ConcealSpec {
	start: number,
	end: number,
	replacement: string,
	class?: string,
	elementType?: string,
}

export interface Concealment extends ConcealSpec {
	cursorPosType: "within" | "apart" | "edge",
	enable: boolean,
}

export type ConcealState = {
	concealments: Concealment[],
	revealTimeout?: NodeJS.Timeout,
}

// Represents how a concealment should be handled
// 'delay' means reveal after a time delay.
type ConcealAction = "conceal" | "reveal" | "delay";


class ConcealWidget extends WidgetType {
	private readonly className: string;
	private readonly elementType: string;

	constructor(readonly symbol: string, className?: string, elementType?: string) {
		super();

		this.className = className ? className : "";
		this.elementType = elementType ? elementType : "span";
	}

	eq(other: ConcealWidget) {
		return ((other.symbol == this.symbol) && (other.className === this.className) && (other.elementType === this.elementType));
	}

	toDOM() {
		const span = document.createElement(this.elementType);
		span.className = "cm-math " + this.className;
		span.textContent = this.symbol;
		return span;
	}

	ignoreEvent() {
		return false;
	}
}

class TextWidget extends WidgetType {

	constructor(readonly symbol: string) {
		super();
	}

	eq(other: TextWidget) {
		return (other.symbol == this.symbol);
	}

	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-math";
		span.textContent = this.symbol;
		return span;
	}

	ignoreEvent() {
		return false;
	}
}

/**
 * Determine if the two ConcealSpec instances before and after the update can be
 * considered identical.
 */
function atSamePosAfter(
	update: ViewUpdate,
	oldConceal: ConcealSpec,
	newConceal: ConcealSpec,
): boolean {
	// Set associativity to ensure that insertions on either side of the concealed
	// region do not expand the region
	const oldStartUpdated = update.changes.mapPos(oldConceal.start, 1);
	const oldEndUpdated = update.changes.mapPos(oldConceal.end, -1);
	return oldStartUpdated == newConceal.start && oldEndUpdated == newConceal.end;
}

function determineCursorPosType(
	sel: EditorSelection,
	concealSpec: ConcealSpec,
): Concealment["cursorPosType"] {

	for (const range of sel.ranges) {
		const overlapRangeFrom = Math.max(range.from, concealSpec.start);
		const overlapRangeTo = Math.min(range.to, concealSpec.end);
		if (
			overlapRangeFrom === overlapRangeTo &&
			(overlapRangeFrom === concealSpec.start || overlapRangeFrom === concealSpec.end)
		) {
			return "edge";
		}

		if (overlapRangeFrom <= overlapRangeTo) return "within";
	}

	return "apart";
}

/*
* We determine how to handle a concealment based on its 'cursorPosType' before
* and after an update and current mousedown state.
*
* When the mouse is down, we 'conceal' all concealments to make selecting math
* expressions easier.
*
* When the mouse is up, we follow the table below.
* The row represents the previous 'cursorPosType' and the column represents the
* current 'cursorPosType'. Each cell contains the action to be taken.
*
*        |  apart  |  edge  | within
* -----------------------------------
* apart  | conceal | delay  | reveal
* edge   | conceal | delay  | reveal
* within | conceal | reveal | reveal
* N/A    | conceal | reveal | reveal
*
* 'N/A' means that the concealment do not exist before the update, which should
* be judged by 'atSamePosAfter' function.
*/
function determineAction(
	oldCursor: Concealment["cursorPosType"] | null,
	newCursor: Concealment["cursorPosType"],
	mousedown: boolean,
): ConcealAction {
	if (mousedown) return "conceal";

	if (newCursor === "apart") return "conceal";
	if (newCursor === "within") return "reveal";

	// newCursor === "edge"
	if (!oldCursor || oldCursor === "within") return "reveal";
	else return "delay";
}

// Build a decoration set from the given conceal state
function buildDecoSet(concealState: ConcealState): DecorationSet {
	const decos: Range<Decoration>[] = [];

	for (const concealment of concealState.concealments) {
		if (!concealment.enable) continue;

		if (concealment.start === concealment.end) {
			// Add an additional "/" symbol, as part of concealing \\frac{}{} -> ()/()
			decos.push(
				Decoration.widget({
					widget: new TextWidget(concealment.replacement),
					block: false,
				}).range(concealment.start, concealment.end)
			);
		}
		else {
			// Improve selecting empty replacements such as "\frac" -> ""
			const inclusiveStart = concealment.replacement === "";
			const inclusiveEnd = false;

			decos.push(
				Decoration.replace({
					widget: new ConcealWidget(
						concealment.replacement,
						concealment.class,
						concealment.elementType,
					),
					inclusiveStart,
					inclusiveEnd,
					block: false,
				}).range(concealment.start, concealment.end)
			);
		}
	}

	return Decoration.set(decos, true);
}

const updateConcealEffect = StateEffect.define<ConcealState>();

export const concealStateField = StateField.define<ConcealState>({
	create() {
		return {
			concealments: []
		};
	},

	update(oldState, transaction) {
		let newState: ConcealState | null = null;

		for (const effect of transaction.effects) {
			if (effect.is(updateConcealEffect)) {
				newState = effect.value;
			}
		}

		if (!newState) return oldState;

		// If the updateConcealEffect is present
		return newState;
	},

	provide: (thisField) => [
		// Provide two extensions

		// Update conceal decorations depending on this field
		EditorView.decorations.compute(
			[thisField],
			(state) => buildDecoSet(state.field(thisField)),
		),

		// Listen to view updates and update this field
		EditorView.updateListener.of((update: ViewUpdate) => {
			if (!(update.docChanged || update.viewportChanged || update.selectionSet))
				return;
			// NOTE: The following lines cause another view update. However, due to
			// the condition above, we can expect that an infinite loop will not
			// occur.

			const oldState = update.startState.field(thisField);
			const selection = update.state.selection;
			const mousedown = update.view.plugin(livePreviewState)?.mousedown;

			if (oldState.revealTimeout) {
				// Cancel the delayed revealment whenever we update the concealments
				clearTimeout(oldState.revealTimeout);
			}

			const concealSpecs = conceal(update.view);

			// Collect concealments from the new conceal specs
			const concealments: Concealment[] = [];
			// concealments that should be revealed after a delay (i.e. 'delay' action)
			const delayedConcealments: Concealment[] = [];

			for (const concealSpec of concealSpecs) {
				const cursorPosType = determineCursorPosType(selection, concealSpec);
				const oldConceal = oldState.concealments.find(
					(old) => atSamePosAfter(update, old, concealSpec)
				);

				const concealAction = determineAction(
					oldConceal?.cursorPosType, cursorPosType, mousedown
				);

				const concealment: Concealment = {
					...concealSpec,
					cursorPosType,
					enable: concealAction !== "reveal",
				};

				if (concealAction === "delay") {
					delayedConcealments.push(concealment);
				}

				concealments.push(concealment);
			}

			// Set a timeout to reveal delayed concealments
			let revealTimeout: NodeJS.Timeout | null = null;
			if (delayedConcealments.length > 0) {
				revealTimeout = setTimeout(() => {
					for (const concealment of delayedConcealments) {
						concealment.enable = false;
					}
					update.view.dispatch({
						effects: [updateConcealEffect.of({ concealments })]
					});
				}, 1000);
			}

			update.view.dispatch({
				effects: [updateConcealEffect.of({
					concealments,
					revealTimeout,
				})]
			});
		}),
	]
})
