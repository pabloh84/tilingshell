import { registerGObjectClass } from '../../utils/gjs';
import { Clutter, Mtk, St } from '../../gi/ext';
import LayoutWidget from '../layout/LayoutWidget';
import Tile from '../layout/Tile';
import SnapAssistTile from './snapAssistTile';
import Layout from '../../components/layout/Layout';
import { buildRectangle } from '../../utils/ui';

export default class SnapAssistLayout extends LayoutWidget<SnapAssistTile> {
    static { registerGObjectClass(this) }
    
    constructor(
        parent: St.Widget,
        layout: Layout,
        innerGaps: Clutter.Margin,
        outerGaps: Clutter.Margin,
        width: number,
        height: number,
    ) {
        super({
            containerRect: buildRectangle({ x: 0, y: 0, width, height }),
            parent,
            layout,
            innerGaps,
            outerGaps,
        });
        this.set_size(width, height);
        super.relayout();
    }

    buildTile(
        parent: Clutter.Actor,
        rect: Mtk.Rectangle,
        gaps: Clutter.Margin,
        tile: Tile,
    ): SnapAssistTile {
        return new SnapAssistTile({ parent, rect, gaps, tile });
    }

    public getTileBelow(cursorPos: {
        x: number;
        y: number;
    }): SnapAssistTile | undefined {
        const [x, y] = this.get_transformed_position();
        let bestTile: SnapAssistTile | undefined;
        let bestDist = Number.MAX_VALUE;

        for (let i = 0; i < this._previews.length; i++) {
            const preview = this._previews[i];
            const pos = { x: x + preview.rect.x, y: y + preview.rect.y };

            const isHovering =
                cursorPos.x >= pos.x &&
                cursorPos.x <= pos.x + preview.rect.width &&
                cursorPos.y >= pos.y &&
                cursorPos.y <= pos.y + preview.rect.height;
            if (isHovering) {
                const center = {
                    x: pos.x + preview.rect.width / 2,
                    y: pos.y + preview.rect.height / 2,
                };
                const dist =
                    (cursorPos.x - center.x) ** 2 +
                    (cursorPos.y - center.y) ** 2;
                if (
                    dist < bestDist ||
                    (Math.abs(dist - bestDist) < 25 &&
                        bestTile &&
                        preview.rect.area() < bestTile.rect.area())
                ) {
                    bestTile = preview;
                    bestDist = dist;
                }
            }
        }

        return bestTile;
    }
}
