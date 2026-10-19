import TilePreview from '../tilepreview/tilePreview';
import { GObject, St, Clutter, Mtk, Meta } from '../../gi/ext';
import Tile from '../layout/Tile';
import Slider from './slider';
import TileUtils from '../layout/TileUtils';
import { registerGObjectClass } from '../../utils/gjs';
import { buildTileGaps } from '../../utils/ui';
import { getEventCoords } from '../../utils/gnomesupport';

function applyCursor(
    actor: Clutter.Actor,
    name: 'default' | 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se',
) {
    if ('set_cursor_type' in actor) {
        // @ts-expect-error "CursorType is available on GNOME 51+"
        const CT = Clutter.CursorType;
        if (CT) {
            let ct = CT.DEFAULT;
            switch (name) {
                case 'move':
                    ct = CT.MOVE ?? CT.ALL_SCROLL;
                    break;
                case 'n':
                    ct = CT.N_RESIZE;
                    break;
                case 's':
                    ct = CT.S_RESIZE;
                    break;
                case 'w':
                    ct = CT.W_RESIZE;
                    break;
                case 'e':
                    ct = CT.E_RESIZE;
                    break;
                case 'nw':
                    ct = CT.NW_RESIZE;
                    break;
                case 'ne':
                    ct = CT.NE_RESIZE;
                    break;
                case 'sw':
                    ct = CT.SW_RESIZE;
                    break;
                case 'se':
                    ct = CT.SE_RESIZE;
                    break;
            }
            // @ts-expect-error "set_cursor_type"
            actor.set_cursor_type(ct);
            return;
        }
    }

    let mc: Meta.Cursor = Meta.Cursor.DEFAULT;
    switch (name) {
        case 'move':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.MOVE ?? Meta.Cursor.ALL_SCROLL ?? Meta.Cursor.DEFAULT;
            break;
        case 'n':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.NORTH_RESIZE ?? Meta.Cursor.N_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 's':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.SOUTH_RESIZE ?? Meta.Cursor.S_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'w':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.WEST_RESIZE ?? Meta.Cursor.W_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'e':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.EAST_RESIZE ?? Meta.Cursor.E_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'nw':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.NORTH_WEST_RESIZE ?? Meta.Cursor.NW_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'ne':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.NORTH_EAST_RESIZE ?? Meta.Cursor.NE_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'sw':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.SOUTH_WEST_RESIZE ?? Meta.Cursor.SW_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
        case 'se':
            // @ts-expect-error "fallback"
            mc = Meta.Cursor.SOUTH_EAST_RESIZE ?? Meta.Cursor.SE_RESIZE ?? Meta.Cursor.DEFAULT;
            break;
    }
    global.display.set_cursor(mc);
}

export default class EditableTilePreview extends TilePreview {
    static { registerGObjectClass(this, {
        Signals: {
            'size-changed': {
                param_types: [Mtk.Rectangle.$gtype, Mtk.Rectangle.$gtype], // oldSize, newSize
            },
            clicked: {
                param_types: [GObject.TYPE_INT], // clicked_button
            },
        },
        GTypeName: 'EditableTilePreview',
    })};

    public static MIN_TILE_SIZE: number = 140;
    public static EDGE_THRESHOLD: number = 18;

    private readonly _btn: St.Button;
    private readonly _containerRect: Mtk.Rectangle;

    private _sliders: (Slider | null)[];
    private _signals: (number | null)[];

    private _dragMode:
        | 'none'
        | 'move'
        | 'n'
        | 's'
        | 'w'
        | 'e'
        | 'nw'
        | 'ne'
        | 'sw'
        | 'se' = 'none';

    private _isDragging = false;
    private _dragStartPos: { x: number; y: number } | null = null;

    private _initialTileProps: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null = null;

    private _grab: any = null;

    constructor(params: {
        tile: Tile;
        containerRect: Mtk.Rectangle;
        parent?: Clutter.Actor;
        rect?: Mtk.Rectangle;
        gaps?: Clutter.Margin;
    }) {
        super(params);
        this.add_style_class_name('editable-tile-preview');
        this._tile = params.tile;
        this._containerRect = params.containerRect;
        this._sliders = [null, null, null, null];
        this._signals = [null, null, null, null];
        this._btn = new St.Button({
            styleClass: 'editable-tile-preview-button',
            xExpand: true,
            trackHover: true,
        });
        this.add_child(this._btn);
        this._btn.set_size(this.innerWidth, this.innerHeight);
        this._btn.set_button_mask(
            St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
        );
        this._updateLabelText();

        this._btn.connect(
            'button-press-event',
            this._onBtnButtonPress.bind(this),
        );
        this._btn.connect(
            'button-release-event',
            this._onBtnButtonRelease.bind(this),
        );
        this._btn.connect('motion-event', this._onBtnMotion.bind(this));
        this._btn.connect('leave-event', this._onBtnLeave.bind(this));

        this.connect('destroy', this._onDestroy.bind(this));
    }

    public override set gaps(newGaps: Clutter.Margin) {
        super.gaps = newGaps;
        this.updateBorderRadius(
            this._gaps.top > 0,
            this._gaps.right > 0,
            this._gaps.bottom > 0,
            this._gaps.left > 0,
        );
    }

    public getSlider(side: St.Side): Slider | null {
        return this._sliders[side];
    }

    public getAllSliders(): (Slider | null)[] {
        return [...this._sliders];
    }

    public get hover(): boolean {
        return this._btn.hover;
    }

    public isNearEdge(localX: number, localY: number): boolean {
        const threshold = EditableTilePreview.EDGE_THRESHOLD;
        return (
            localX <= threshold ||
            localX >= this.width - threshold ||
            localY <= threshold ||
            localY >= this.height - threshold
        );
    }

    public addSlider(slider: Slider, side: St.Side) {
        // if there were another slider on that side, disconnect the signal
        const sig = this._signals[side];
        if (sig) this._sliders[side]?.disconnect(sig);

        // add this slider
        this._sliders[side] = slider;
        this._signals[side] = slider.connect('slide', () =>
            this._onSliderMove(side),
        );

        // update tile's groups
        this._tile.groups = [];
        this._sliders.forEach((sl) => sl && this._tile.groups.push(sl.groupId));
    }

    public removeSlider(side: St.Side) {
        if (this._sliders[side] === null) return;

        // disconnect signals
        const sig = this._signals[side];
        if (sig) this._sliders[side]?.disconnect(sig);

        // remove slider
        this._sliders[side] = null;

        // update tile's groups
        this._tile.groups = [];
        this._sliders.forEach((sl) => sl && this._tile.groups.push(sl.groupId));
    }

    public detachSlider(side: St.Side) {
        const slider = this._sliders[side];
        if (slider) {
            slider.detachTile(this);
        }
    }

    public detachFromAllSliders() {
        for (let side = 0; side < 4; side++) {
            this.detachSlider(side);
        }
    }

    public updateTile({
        x,
        y,
        width,
        height,
        innerGaps,
        outerGaps,
    }: {
        x: number;
        y: number;
        width: number;
        height: number;
        innerGaps?: Clutter.Margin;
        outerGaps?: Clutter.Margin;
    }) {
        const oldSize = this._rect.copy();
        this._tile.x = x;
        this._tile.y = y;
        this._tile.width = width;
        this._tile.height = height;
        this._rect = TileUtils.apply_props(this._tile, this._containerRect);
        if (innerGaps && outerGaps) {
            const isOverlapping = this._tile.groups.length === 0;
            this.gaps = buildTileGaps(
                this._rect,
                innerGaps,
                outerGaps,
                this._containerRect,
                1,
                isOverlapping,
            ).gaps;
        }

        this.set_size(this.innerWidth, this.innerHeight);
        this.set_position(this.innerX, this.innerY);

        this._btn.set_size(this.width, this.height);
        this._updateLabelText();

        const newSize = this._rect.copy();
        this.emit('size-changed', oldSize, newSize);
    }

    public connect(_id: string, _callback: (..._args: any[]) => any): number;
    public connect(_signal: 'size-changed', _callback: (_source: this, _oldSize: Mtk.Rectangle, _newSize: Mtk.Rectangle) => void): number;
    public connect(_signal: 'notify::hover', _callback: (_source: this) => void): number;
    public connect(_signal: 'clicked', _callback: (_source: this, _clicked_button: number) => void): number;
    public connect(signal: string, callback: never): number {
        if (signal === 'notify::hover' || signal === 'motion-event')
            return this._btn.connect(signal, callback);

        return super.connect(signal, callback);
    }

    private _updateLabelText() {
        this._btn.label = `${this.innerWidth}x${this.innerHeight}`;
    }

    private _getResizeEdge(
        localX: number,
        localY: number,
        shiftPressed: boolean,
    ): 'none' | 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se' {
        const threshold = EditableTilePreview.EDGE_THRESHOLD;
        const nearL = localX <= threshold;
        const nearR = localX >= this.width - threshold;
        const nearT = localY <= threshold;
        const nearB = localY >= this.height - threshold;

        const hasNoSliders = this._sliders.every((s) => s === null);
        const allowEdge = shiftPressed || hasNoSliders;

        if (allowEdge) {
            if (nearT && nearL) return 'nw';
            if (nearT && nearR) return 'ne';
            if (nearB && nearL) return 'sw';
            if (nearB && nearR) return 'se';
            if (nearT) return 'n';
            if (nearB) return 's';
            if (nearL) return 'w';
            if (nearR) return 'e';
        } else {
            const topFree = this._sliders[St.Side.TOP] === null;
            const bottomFree = this._sliders[St.Side.BOTTOM] === null;
            const leftFree = this._sliders[St.Side.LEFT] === null;
            const rightFree = this._sliders[St.Side.RIGHT] === null;

            if (nearT && nearL && topFree && leftFree) return 'nw';
            if (nearT && nearR && topFree && rightFree) return 'ne';
            if (nearB && nearL && bottomFree && leftFree) return 'sw';
            if (nearB && nearR && bottomFree && rightFree) return 'se';
            if (nearT && topFree) return 'n';
            if (nearB && bottomFree) return 's';
            if (nearL && leftFree) return 'w';
            if (nearR && rightFree) return 'e';
        }

        if (shiftPressed) return 'move';
        return 'none';
    }

    private _onBtnButtonPress(_: Clutter.Actor, event: Clutter.ButtonEvent): boolean {
        const button = event.get_button();
        const [stageX, stageY] = getEventCoords(event);
        const localX = stageX - this.x;
        const localY = stageY - this.y;
        const modifier = event.get_state();
        const shiftPressed = (modifier & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (button === 2) {
            this.emit('clicked', 2);
            return Clutter.EVENT_STOP;
        }

        if (button === 3) {
            this.emit('clicked', 3);
            return Clutter.EVENT_STOP;
        }

        if (button === 1) {
            const mode = this._getResizeEdge(localX, localY, shiftPressed);
            this._dragMode = mode;
            this._dragStartPos = { x: stageX, y: stageY };
            this._initialTileProps = {
                x: this._tile.x,
                y: this._tile.y,
                width: this._tile.width,
                height: this._tile.height,
            };
            this._isDragging = false;
            this._grab = global.stage.grab(this._btn);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    private _onBtnMotion(_: Clutter.Actor, event: Clutter.MotionEvent): boolean {
        const [stageX, stageY] = getEventCoords(event);
        const localX = stageX - this.x;
        const localY = stageY - this.y;
        const modifier = event.get_state();
        const shiftPressed = (modifier & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (this._dragStartPos && this._initialTileProps) {
            const dist = Math.hypot(
                stageX - this._dragStartPos.x,
                stageY - this._dragStartPos.y,
            );
            if (dist > 5) {
                this._isDragging = true;
            }

            if (this._isDragging && this._dragMode !== 'none') {
                this._handleDrag(stageX, stageY);
                return Clutter.EVENT_STOP;
            }
        }

        if (!this._isDragging) {
            const mode = this._getResizeEdge(localX, localY, shiftPressed);
            applyCursor(this._btn, mode === 'none' ? 'default' : mode);
        }

        return Clutter.EVENT_PROPAGATE;
    }

    private _handleDrag(stageX: number, stageY: number): void {
        if (!this._dragStartPos || !this._initialTileProps) return;

        const deltaX =
            (stageX - this._dragStartPos.x) / this._containerRect.width;
        const deltaY =
            (stageY - this._dragStartPos.y) / this._containerRect.height;

        const minW =
            EditableTilePreview.MIN_TILE_SIZE / this._containerRect.width;
        const minH =
            EditableTilePreview.MIN_TILE_SIZE / this._containerRect.height;

        let newX = this._initialTileProps.x;
        let newY = this._initialTileProps.y;
        let newW = this._initialTileProps.width;
        let newH = this._initialTileProps.height;

        if (this._dragMode === 'move') {
            this.detachFromAllSliders();
            newX = Math.max(
                0,
                Math.min(1 - newW, this._initialTileProps.x + deltaX),
            );
            newY = Math.max(
                0,
                Math.min(1 - newH, this._initialTileProps.y + deltaY),
            );
        } else {
            if (this._dragMode.includes('w')) {
                this.detachSlider(St.Side.LEFT);
                const maxLeft =
                    this._initialTileProps.x +
                    this._initialTileProps.width -
                    minW;
                newX = Math.max(
                    0,
                    Math.min(maxLeft, this._initialTileProps.x + deltaX),
                );
                newW =
                    this._initialTileProps.width +
                    (this._initialTileProps.x - newX);
            }
            if (this._dragMode.includes('e')) {
                this.detachSlider(St.Side.RIGHT);
                const maxW = 1 - this._initialTileProps.x;
                newW = Math.max(
                    minW,
                    Math.min(maxW, this._initialTileProps.width + deltaX),
                );
            }
            if (this._dragMode.includes('n')) {
                this.detachSlider(St.Side.TOP);
                const maxTop =
                    this._initialTileProps.y +
                    this._initialTileProps.height -
                    minH;
                newY = Math.max(
                    0,
                    Math.min(maxTop, this._initialTileProps.y + deltaY),
                );
                newH =
                    this._initialTileProps.height +
                    (this._initialTileProps.y - newY);
            }
            if (this._dragMode.includes('s')) {
                this.detachSlider(St.Side.BOTTOM);
                const maxH = 1 - this._initialTileProps.y;
                newH = Math.max(
                    minH,
                    Math.min(maxH, this._initialTileProps.height + deltaY),
                );
            }
        }

        this.updateTile({
            x: newX,
            y: newY,
            width: newW,
            height: newH,
        });
    }

    private _onBtnButtonRelease(
        _: Clutter.Actor,
        event: Clutter.ButtonEvent,
    ): boolean {
        const button = event.get_button();
        const [stageX, stageY] = getEventCoords(event);

        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }

        if (button === 1 && this._dragStartPos) {
            const dist = Math.hypot(
                stageX - this._dragStartPos.x,
                stageY - this._dragStartPos.y,
            );
            const wasDragging = this._isDragging;

            this._dragStartPos = null;
            this._initialTileProps = null;
            this._isDragging = false;
            this._dragMode = 'none';

            if (!wasDragging && dist <= 5) {
                this.emit('clicked', 1);
            }
            applyCursor(this._btn, 'default');
            return Clutter.EVENT_STOP;
        }

        this._dragStartPos = null;
        this._initialTileProps = null;
        this._isDragging = false;
        this._dragMode = 'none';
        applyCursor(this._btn, 'default');

        return Clutter.EVENT_PROPAGATE;
    }

    private _onBtnLeave(): void {
        if (!this._isDragging) {
            applyCursor(this._btn, 'default');
        }
    }

    private _onSliderMove(side: St.Side) {
        const slider = this._sliders[side];
        if (slider === null) return;

        const posHoriz =
            (slider.x + slider.width / 2 - this._containerRect.x) /
            this._containerRect.width;
        const posVert =
            (slider.y + slider.height / 2 - this._containerRect.y) /
            this._containerRect.height;
        switch (side) {
            case St.Side.TOP:
                this._tile.height += this._tile.y - posVert;
                this._tile.y = posVert;
                break;
            case St.Side.RIGHT:
                this._tile.width = posHoriz - this._tile.x;
                break;
            case St.Side.BOTTOM:
                this._tile.height = posVert - this._tile.y;
                break;
            case St.Side.LEFT:
                this._tile.width += this._tile.x - posHoriz;
                this._tile.x = posHoriz;
                break;
        }

        this.updateTile({ ...this._tile });
    }

    private _onDestroy(): void {
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
        this._signals.forEach(
            (id, side) => id && this._sliders[side]?.disconnect(id),
        );
    }
}
