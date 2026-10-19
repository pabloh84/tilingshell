import { registerGObjectClass } from '../../utils/gjs';
import { St, Clutter, Mtk, Meta } from '../../gi/ext';
import { TilePreviewConstructorProperties } from '../tilepreview/tilePreview';
import TilePreview from '../tilepreview/tilePreview';
import LayoutWidget from '../layout/LayoutWidget';
import Layout from '../layout/Layout';
import Tile from '../layout/Tile';
import {
    buildRectangle,
    buildTileGaps,
    isPointInsideRect,
    squaredEuclideanDistance,
} from '../../utils/ui';
import TileUtils from '../../components/layout/TileUtils';
import GlobalState from '../../utils/globalState';
import { KeyBindingsDirection } from '../../keybindings';

class DynamicTilePreview extends TilePreview {
    static { registerGObjectClass(this) }

    private _originalRect: Mtk.Rectangle;
    private _canRestore: boolean;
    private _tileIndex?: number;
    private _centerBadge: St.Bin | null = null;

    constructor(
        params: Partial<TilePreviewConstructorProperties>,
        canRestore?: boolean,
        tileIndex?: number,
    ) {
        super(params);
        this._canRestore = canRestore || false;
        this._tileIndex = tileIndex;
        this._originalRect = this.rect.copy();
    }

    public get tileIndex(): number | undefined {
        return this._tileIndex;
    }

    public setCenterBadge(badge: St.Bin | null): void {
        this._centerBadge = badge;
    }

    public get centerBadge(): St.Bin | null {
        return this._centerBadge;
    }

    public updateBadgePosition(): void {
        if (!this._centerBadge) return;
        const centerX = this.innerX + this.innerWidth / 2;
        const centerY = this.innerY + this.innerHeight / 2;
        this._centerBadge.set_position(
            Math.round(centerX - 19),
            Math.round(centerY - 19),
        );
    }

    public setIndicatorActive(active: boolean): void {
        if (!this._centerBadge) return;
        if (active) {
            this._centerBadge.add_style_class_name(
                'tile-preview-center-badge-active',
            );
        } else {
            this._centerBadge.remove_style_class_name(
                'tile-preview-center-badge-active',
            );
        }
    }

    public get originalRect(): Mtk.Rectangle {
        return this._originalRect;
    }

    public get canRestore(): boolean {
        return this._canRestore;
    }

    public override open(position: Mtk.Rectangle | undefined = undefined, ease: boolean = false): void {
        super.open(position, ease);
        this.updateBadgePosition();
    }

    public restore(ease: boolean = false): boolean {
        if (!this._canRestore) return false;

        this._rect = this._originalRect.copy();
        if (this.showing) this.open(undefined, ease);

        return true;
    }
}

/**
 * A TilingLayout is a group of multiple tile previews. By aggregating all of them,
 * it is possible to easily show and hide each tile at the same time and to get the
 * hovered tile.
 */
export default class TilingLayout extends LayoutWidget<DynamicTilePreview> {
    static { registerGObjectClass(this) }

    private static readonly BADGE_ATTRACTION_RADIUS = 75; // px
    private static readonly HYSTERESIS_MARGIN = 70; // px

    private _showing: boolean;
    private _badgesGroup: St.Widget;
    private _lastSelectedCandidate: DynamicTilePreview | null = null;

    constructor(
        layout: Layout,
        innerGaps: Clutter.Margin,
        outerGaps: Clutter.Margin,
        workarea: Mtk.Rectangle,
        scalingFactor?: number,
    ) {
        super({
            containerRect: workarea,
            parent: global.windowGroup,
            layout,
            innerGaps,
            outerGaps,
            scalingFactor,
        });
        this._badgesGroup = new St.Widget({
            name: 'tilingshell-badges-group',
            reactive: false,
        });
        global.windowGroup.add_child(this._badgesGroup);
        this._badgesGroup.hide();

        this._showing = false;
        super.relayout();
    }

    _init() {
        super._init();
        this.hide();
    }

    protected override draw_layout(): void {
        if (this._badgesGroup) {
            this._badgesGroup.destroy_all_children();
        }
        super.draw_layout();
    }

    protected buildTile(
        parent: Clutter.Actor,
        rect: Mtk.Rectangle,
        gaps: Clutter.Margin,
        tile: Tile,
        index?: number,
    ): DynamicTilePreview {
        const prev = new DynamicTilePreview(
            { parent, rect, gaps, tile },
            true,
            index,
        );
        prev.updateBorderRadius(
            prev.gaps.top > 0,
            prev.gaps.right > 0,
            prev.gaps.bottom > 0,
            prev.gaps.left > 0,
        );

        if (index !== undefined && this._badgesGroup) {
            const label = new St.Label({
                text: `${index}`,
                styleClass: 'tile-preview-center-badge-label',
                xAlign: Clutter.ActorAlign.CENTER,
                yAlign: Clutter.ActorAlign.CENTER,
            });
            const badge = new St.Bin({
                styleClass: 'tile-preview-center-badge',
                child: label,
                xAlign: Clutter.ActorAlign.CENTER,
                yAlign: Clutter.ActorAlign.CENTER,
            });
            this._badgesGroup.add_child(badge);
            prev.setCenterBadge(badge);
            prev.updateBadgePosition();
        }

        return prev;
    }

    public bringBadgesToFront(): void {
        if (
            this._badgesGroup &&
            this._badgesGroup.get_parent() === global.windowGroup
        ) {
            global.windowGroup.set_child_above_sibling(this._badgesGroup, null);
        }
    }

    public override destroy(): void {
        if (this._badgesGroup) {
            this._badgesGroup.destroy();
        }
        super.destroy();
    }

    public get showing(): boolean {
        return this._showing;
    }

    public openBelow(window: Meta.Window) {
        if (this._showing) return;

        const windowActor = window.get_compositor_private() as Clutter.Actor;
        if (!windowActor) return;

        global.windowGroup.set_child_below_sibling(this, windowActor);
        this.open();
    }

    public openAbove(_window: Meta.Window) {
        if (this._showing) return;

        global.windowGroup.set_child_above_sibling(this, null);
        this.open();
    }

    public open(ease: boolean = false) {
        if (this._showing) return;

        this.show();
        this._showing = true;
        this.bringBadgesToFront();
        this._badgesGroup.show();
        this._previews.forEach((p) => p.updateBadgePosition());

        this.ease({
            x: this.x,
            y: this.y,
            opacity: 255,
            duration: ease ? GlobalState.get().tilePreviewAnimationTime : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._badgesGroup.ease({
            opacity: 255,
            duration: ease ? GlobalState.get().tilePreviewAnimationTime : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    public close(ease: boolean = false) {
        if (!this._showing) return;

        this._showing = false;
        this._lastSelectedCandidate = null;

        this.ease({
            opacity: 0,
            duration: ease ? GlobalState.get().tilePreviewAnimationTime : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.unhoverAllTiles();
                this.hide();
            },
        });

        this._badgesGroup.ease({
            opacity: 0,
            duration: ease ? GlobalState.get().tilePreviewAnimationTime : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._badgesGroup.hide();
            },
        });
    }

    private _isHovered(
        currPointerPos: { x: number; y: number },
        preview: Mtk.Rectangle,
    ): boolean {
        return (
            currPointerPos.x >= preview.x &&
            currPointerPos.x <= preview.x + preview.width &&
            currPointerPos.y >= preview.y &&
            currPointerPos.y <= preview.y + preview.height
        );
    }

    public getTileBelow(
        currPointerPos: { x: number; y: number },
        reset: boolean,
    ): Mtk.Rectangle | undefined {
        let candidates = this._previews.filter((preview) =>
            this._isHovered(currPointerPos, preview.rect),
        );
        if (
            candidates.length === 0 ||
            (!candidates.some((c) => c.canRestore) && reset)
        ) {
            candidates = this._previews.filter(
                (preview) =>
                    preview.canRestore &&
                    this._isHovered(currPointerPos, preview.originalRect),
            );
        }
        if (candidates.length === 0) {
            this._previews.forEach((p) => p.setIndicatorActive(false));
            this._lastSelectedCandidate = null;
            return undefined;
        }

        // 1. Priority: Badge Attraction zone
        let bestAttractionCandidate: DynamicTilePreview | null = null;
        let minAttractionDist = Number.MAX_VALUE;

        for (const candidate of candidates) {
            const r =
                reset && candidate.canRestore
                    ? candidate.originalRect
                    : candidate.rect;
            const centerX = r.x + r.width / 2;
            const centerY = r.y + r.height / 2;
            const dist = Math.hypot(
                centerX - currPointerPos.x,
                centerY - currPointerPos.y,
            );

            if (
                dist <= TilingLayout.BADGE_ATTRACTION_RADIUS &&
                dist < minAttractionDist
            ) {
                minAttractionDist = dist;
                bestAttractionCandidate = candidate;
            }
        }

        let bestCandidate: DynamicTilePreview;

        if (bestAttractionCandidate !== null) {
            bestCandidate = bestAttractionCandidate;
        } else if (
            this._lastSelectedCandidate &&
            candidates.includes(this._lastSelectedCandidate)
        ) {
            // 2. Hysteresis: only switch if another candidate is at least HYSTERESIS_MARGIN closer
            const lastR =
                reset && this._lastSelectedCandidate.canRestore
                    ? this._lastSelectedCandidate.originalRect
                    : this._lastSelectedCandidate.rect;
            const lastDist = Math.hypot(
                lastR.x + lastR.width / 2 - currPointerPos.x,
                lastR.y + lastR.height / 2 - currPointerPos.y,
            );

            let challenger: DynamicTilePreview | null = null;
            let challengerDist = Number.MAX_VALUE;

            for (const candidate of candidates) {
                if (candidate === this._lastSelectedCandidate) continue;
                const r =
                    reset && candidate.canRestore
                        ? candidate.originalRect
                        : candidate.rect;
                const dist = Math.hypot(
                    r.x + r.width / 2 - currPointerPos.x,
                    r.y + r.height / 2 - currPointerPos.y,
                );

                if (dist < challengerDist) {
                    challengerDist = dist;
                    challenger = candidate;
                }
            }

            if (
                challenger &&
                challengerDist < lastDist - TilingLayout.HYSTERESIS_MARGIN
            ) {
                bestCandidate = challenger;
            } else {
                bestCandidate = this._lastSelectedCandidate;
            }
        } else {
            // 3. Fallback: pick the closest candidate by center distance
            let closest = candidates[0];
            let minDist = Number.MAX_VALUE;

            for (const candidate of candidates) {
                const r =
                    reset && candidate.canRestore
                        ? candidate.originalRect
                        : candidate.rect;
                const dist = Math.hypot(
                    r.x + r.width / 2 - currPointerPos.x,
                    r.y + r.height / 2 - currPointerPos.y,
                );
                if (dist < minDist) {
                    minDist = dist;
                    closest = candidate;
                }
            }
            bestCandidate = closest;
        }

        this._lastSelectedCandidate = bestCandidate;

        this._previews.forEach((p) => {
            p.setIndicatorActive(p === bestCandidate);
        });
        this.bringBadgesToFront();

        if (reset && bestCandidate.originalRect)
            return bestCandidate.originalRect;
        return bestCandidate.rect;
    }

    public hasOverlappingTiles(): boolean {
        for (let i = 0; i < this._previews.length; i++) {
            for (let j = i + 1; j < this._previews.length; j++) {
                const [intersects] = this._previews[i].rect.intersect(
                    this._previews[j].rect,
                );
                if (intersects) return true;
            }
        }
        return false;
    }

    public unhoverAllTiles() {
        this._lastSelectedCandidate = null;
        const newPreviewsArray: DynamicTilePreview[] = [];
        this._previews.forEach((preview) => {
            preview.setIndicatorActive(false);
            if (preview.restore(true)) {
                newPreviewsArray.push(preview);
                preview.open(undefined, true);
            } else {
                this.remove_child(preview);
                preview.destroy();
            }
        });
        this._previews = newPreviewsArray;
    }

    public hoverTilesInRect(rect: Mtk.Rectangle, reset: boolean) {
        if (this.hasOverlappingTiles()) {
            this._previews.forEach((preview) => {
                if (reset) {
                    preview.restore(true);
                }
                preview.open(undefined, true);
            });
            return;
        }

        const newPreviewsArray: DynamicTilePreview[] = [];

        this._previews.forEach((preview) => {
            const [hasIntersection, rectangles] = this._subtractRectangles(
                preview.rect,
                rect,
            );
            if (hasIntersection) {
                if (rectangles.length > 0) {
                    let maxIndex = 0;
                    for (let i = 0; i < rectangles.length; i++) {
                        if (rectangles[i].area() > rectangles[maxIndex].area())
                            maxIndex = i;
                    }
                    for (let i = 0; i < rectangles.length; i++) {
                        if (i === maxIndex) continue;

                        const currRect = rectangles[i];
                        const gaps = buildTileGaps(
                            currRect,
                            this._innerGaps,
                            this._outerGaps,
                            this._containerRect,
                        ).gaps;
                        const innerPreview = new DynamicTilePreview(
                            {
                                parent: this,
                                rect: currRect,
                                gaps,
                                tile: TileUtils.build_tile(
                                    currRect,
                                    this._containerRect,
                                ),
                            },
                            false,
                        );
                        innerPreview.open();
                        this.set_child_above_sibling(innerPreview, preview);
                        newPreviewsArray.push(innerPreview);
                    }
                    preview.open(
                        rectangles[maxIndex].union(
                            preview.rect.intersect(rect)[1],
                        ),
                        false,
                    );
                    preview.open(rectangles[maxIndex], true);
                    newPreviewsArray.push(preview);
                } else {
                    preview.close();
                    newPreviewsArray.push(preview);
                }
            } else if (reset /* && !preview.originalRect.intersect(rect)[0]*/) {
                if (preview.restore(true)) {
                    preview.open(undefined, true);
                    newPreviewsArray.push(preview);
                } else {
                    this.remove_child(preview);
                    preview.destroy();
                }
            } else {
                preview.open(undefined, true);
                newPreviewsArray.push(preview);
            }
        });

        this._previews = newPreviewsArray;
    }

    /*
        Given the source rectangle (made by A, B, C, D and Hole), subtract the hole and obtain A, B, C and D.
        Edge cases:
            - The hole may not be inside the source rect (i.e there is no interstaction).
            It returns false and an array with the source rectangle only
            - The hole intersects the source rectangle, it returns true and an array with A, B, C and D rectangles.
            Some of A, B, C and D may not be returned if they don't exist
            - The hole is equal to the source rectangle, it returns true and an empty array since A, B, C and D
            rectangles do not exist

        Example:
        -------------------------
        |          A            |
        |-----------------------|
        |  B  |   hole    |  C  |
        |-----------------------|
        |          D            |
        -------------------------
    */
    private _subtractRectangles(
        sourceRect: Mtk.Rectangle,
        holeRect: Mtk.Rectangle,
    ): [boolean, Mtk.Rectangle[]] {
        const [hasIntersection, intersection] = sourceRect.intersect(holeRect);

        if (!hasIntersection) return [false, [sourceRect]];

        if (intersection.area() >= sourceRect.area() * 0.98) return [true, []];

        const results: Mtk.Rectangle[] = [];

        // A
        const heightA = intersection.y - sourceRect.y;
        if (heightA > 0) {
            results.push(
                buildRectangle({
                    x: sourceRect.x,
                    y: sourceRect.y,
                    width: sourceRect.width,
                    height: heightA,
                }),
            );
        }

        // B
        const widthB = intersection.x - sourceRect.x;
        if (widthB > 0 && intersection.height > 0) {
            results.push(
                buildRectangle({
                    x: sourceRect.x,
                    y: intersection.y,
                    width: widthB,
                    height: intersection.height,
                }),
            );
        }

        // C
        const widthC =
            sourceRect.x +
            sourceRect.width -
            intersection.x -
            intersection.width;
        if (widthC > 0 && intersection.height > 0) {
            results.push(
                buildRectangle({
                    x: intersection.x + intersection.width,
                    y: intersection.y,
                    width: widthC,
                    height: intersection.height,
                }),
            );
        }

        // D
        const heightD =
            sourceRect.y +
            sourceRect.height -
            intersection.y -
            intersection.height;
        if (heightD > 0) {
            results.push(
                buildRectangle({
                    x: sourceRect.x,
                    y: intersection.y + intersection.height,
                    width: sourceRect.width,
                    height: heightD,
                }),
            );
        }

        return [true, results];
    }

    // enlarge the side of the direction and search a tile that contains that point
    // clamp to ensure we do not go outside of the container area (e.g. the screen)
    public findNearestTileDirection(
        source: Mtk.Rectangle,
        direction: KeyBindingsDirection,
        clamp: boolean,
        enlarge: number,
    ): { rect: Mtk.Rectangle; tile: Tile } | undefined {
        if (direction === KeyBindingsDirection.NODIRECTION) return undefined;

        const sourceCoords = {
            x: source.x + source.width / 2,
            y: source.y + source.height / 2,
        };

        switch (direction) {
            case KeyBindingsDirection.RIGHT:
                sourceCoords.x = source.x + source.width + enlarge;
                break;
            case KeyBindingsDirection.LEFT:
                sourceCoords.x = source.x - enlarge;
                break;
            case KeyBindingsDirection.DOWN:
                sourceCoords.y = source.y + source.height + enlarge;
                break;
            case KeyBindingsDirection.UP:
                sourceCoords.y = source.y - enlarge;
                break;
        }

        // if the point to search is outside the container
        if (
            sourceCoords.x < this._containerRect.x ||
            sourceCoords.x >
                this._containerRect.width + this._containerRect.x ||
            sourceCoords.y < this._containerRect.y ||
            sourceCoords.y > this._containerRect.height + this._containerRect.y
        ) {
            if (!clamp) return undefined; // we can already return undefined

            sourceCoords.x = Math.clamp(
                sourceCoords.x,
                this._containerRect.x,
                this._containerRect.width + this._containerRect.x,
            );
            sourceCoords.y = Math.clamp(
                sourceCoords.y,
                this._containerRect.y,
                this._containerRect.height + this._containerRect.y,
            );
        }

        // uncomment to show debugging
        /* global.windowGroup
            .get_children()
            .filter((c) => c.get_name() === 'debug-kb')[0]
            ?.destroy();
        const debugWidget = new St.Widget({
            x: sourceCoords.x - 8,
            y: sourceCoords.y - 8,
            height: 16,
            width: 16,
            style: 'border: 2px solid red; border-radius: 8px;',
            name: 'debug-kb',
        });
        global.windowGroup.add_child(debugWidget);*/

        const candidates: { preview: DynamicTilePreview; distance: number }[] =
            [];
        for (let i = 0; i < this._previews.length; i++) {
            const previewFound = this._previews[i];
            if (isPointInsideRect(sourceCoords, previewFound.rect)) {
                const center = {
                    x: previewFound.innerX + previewFound.innerWidth / 2,
                    y: previewFound.innerY + previewFound.innerHeight / 2,
                };
                candidates.push({
                    preview: previewFound,
                    distance: squaredEuclideanDistance(center, sourceCoords),
                });
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            const previewFound = candidates[0].preview;
            return {
                rect: buildRectangle({
                    x: previewFound.innerX,
                    y: previewFound.innerY,
                    width: previewFound.innerWidth,
                    height: previewFound.innerHeight,
                }),
                tile: previewFound.tile,
            };
        }

        return undefined;
    }

    public findNearestTile(
        source: Mtk.Rectangle,
    ): { rect: Mtk.Rectangle; tile: Tile } | undefined {
        let previewFound: DynamicTilePreview | undefined;
        let bestDistance = -1;

        const sourceCenter = {
            x: source.x + source.width / 2,
            y: source.y + source.height / 2,
        };

        for (let i = 0; i < this._previews.length; i++) {
            const preview = this._previews[i];

            const previewCenter = {
                x: preview.innerX + preview.innerWidth / 2,
                y: preview.innerY + preview.innerHeight / 2,
            };

            const euclideanDistance = squaredEuclideanDistance(
                previewCenter,
                sourceCenter,
            );

            if (!previewFound || euclideanDistance < bestDistance) {
                previewFound = preview;
                bestDistance = euclideanDistance;
            }
        }

        if (!previewFound) return undefined;

        return {
            rect: buildRectangle({
                x: previewFound.innerX,
                y: previewFound.innerY,
                width: previewFound.innerWidth,
                height: previewFound.innerHeight,
            }),
            tile: previewFound.tile,
        };
    }
}
