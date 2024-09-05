// https://discuss.codemirror.net/t/concealing-syntax/3135

import { EditorView, ViewUpdate, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { Range, StateEffect, StateField } from "@codemirror/state";
import { conceal } from "./conceal_fns";


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

export type ConcealState = Concealment[];


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

// Build a decoration set from the given conceal state
function buildDecoSet(concealState: ConcealState): DecorationSet {
	const decos: Range<Decoration>[] = [];

	for (const concealment of concealState) {
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

const updateConcealEffect = StateEffect.define<ViewUpdate>();

export const concealStateField = StateField.define<ConcealState>({
  create() {
    return [];
  },

  update(oldState, transaction) {
    let viewUpdate: ViewUpdate | null = null;

    for (const effect of transaction.effects) {
      if (effect.is(updateConcealEffect))
        viewUpdate = effect.value;
    }

    if (!viewUpdate) return oldState;

    // If the updateConcealEffect is present
    return conceal(viewUpdate.view);
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
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				// NOTE: The following lines cause another view update. However, due to
				// the condition above, we can expect that an infinite loop will not
				// occur.
				update.view.dispatch({
					effects: updateConcealEffect.of(update),
				});
			}
		}),
	]
})
