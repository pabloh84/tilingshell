import { registerGObjectClass } from '../../utils/gjs';
import { GObject, St, Clutter, Mtk, Meta, Shell } from '../../gi/ext';
import Settings from '../../settings/settings';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    buildMargin,
    buildRectangle,
    buildTileGaps,
    enableScalingFactorSupport,
    getMonitorScalingFactor,
    getWindowsOfMonitor,
} from '../../utils/ui';
import Layout from '../layout/Layout';
import TileUtils from '../layout/TileUtils';
import Slider from './slider';
import EditableTilePreview from './editableTilePreview';
import Tile from '../layout/Tile';
import HoverLine from './hoverLine';
import { Monitor } from 'resource:///org/gnome/shell/ui/layout.js';
import { getEventCoords } from '../../utils/gnomesupport';

export default class LayoutEditor extends St.Widget {
    static { registerGObjectClass(this) }
    
    private _layout: Layout;
    private _containerRect: Mtk.Rectangle;
    private _innerGaps: Clutter.Margin;
    private _outerGaps: Clutter.Margin;
    private _hoverWidget: HoverLine;
    private _sliders: Slider[];
    private _editableTiles: EditableTilePreview[];

    private _minimizedWindows: Meta.Window[];

    constructor(layout: Layout, monitor: Monitor, enableScaling: boolean) {
        super({ styleClass: 'layout-editor' });

        Main.layoutManager.addChrome(this);
        global.windowGroup.bind_property(
            'visible',
            this,
            'visible',
            GObject.BindingFlags.DEFAULT,
        );

        if (enableScaling) {
            const scalingFactor = getMonitorScalingFactor(monitor.index);
            enableScalingFactorSupport(this, scalingFactor);
        }

        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            monitor.index,
        );
        this.set_position(workArea.x, workArea.y);
        this.set_size(workArea.width, workArea.height);
        this._innerGaps = buildMargin(Settings.get_inner_gaps());
        this._outerGaps = buildMargin(Settings.get_outer_gaps());
        this._sliders = [];
        this._editableTiles = [];
        this._containerRect = buildRectangle({
            x: 0,
            y: 0,
            width: workArea.width,
            height: workArea.height,
        });

        this._minimizedWindows = getWindowsOfMonitor(monitor).filter(
            (win) => !win.is_hidden(),
        );
        this._minimizedWindows.forEach(
            (win) => win.can_minimize() && win.minimize(),
        );

        this._hoverWidget = new HoverLine(this);

        this._layout = layout;
        this._drawEditor();
        this.grab_key_focus();

        this.connect('destroy', this._onDestroy.bind(this));
    }

    public get layout(): Layout {
        return this._layout;
    }

    public set layout(newLayout: Layout) {
        // cleanup
        this.destroy_all_children();
        this._sliders = [];
        this._editableTiles = [];
        this._hoverWidget = new HoverLine(this);

        // change layout
        this._layout = newLayout;

        this._drawEditor();
    }

    public addOverlappingTile(xNorm?: number, yNorm?: number) {
        const width = 0.5;
        const height = 0.5;
        let x = xNorm !== undefined ? xNorm - width / 2 : 0.25;
        let y = yNorm !== undefined ? yNorm - height / 2 : 0.25;
        x = Math.max(0, Math.min(1 - width, x));
        y = Math.max(0, Math.min(1 - height, y));

        const tile = new Tile({
            x,
            y,
            width,
            height,
            groups: [],
        });

        const rect = TileUtils.apply_props(tile, this._containerRect);
        this._layout.tiles.push(tile);
        const editableTile = this._buildEditableTile(tile, rect);
        this._editableTiles.push(editableTile);
        this._ensureSlidersOnTop();
    }

    public cycleTileLayer(clickedTile: EditableTilePreview) {
        const [stageX, stageY] = Shell.Global.get().get_pointer();
        const relX = stageX - this.x;
        const relY = stageY - this.y;

        const overlapping = this._editableTiles.filter((t) => {
            return (
                relX >= t.x &&
                relX <= t.x + t.width &&
                relY >= t.y &&
                relY <= t.y + t.height
            );
        });

        if (overlapping.length <= 1) return;

        const currentIndex = overlapping.indexOf(clickedTile);
        const nextIndex = (currentIndex + 1) % overlapping.length;
        const nextTile = overlapping[nextIndex];
        this.set_child_above_sibling(nextTile, clickedTile);
        this._ensureSlidersOnTop();
    }

    private _ensureSlidersOnTop() {
        for (const slider of this._sliders) {
            this.set_child_above_sibling(slider, null);
        }
    }

    private _drawEditor() {
        const groups = new Map<number, EditableTilePreview[]>();
        this._editableTiles = [];

        // render layout's tile and group tiles
        this._layout.tiles.forEach((tile) => {
            const rect = TileUtils.apply_props(tile, this._containerRect);
            const prev = this._buildEditableTile(tile, rect);
            this._editableTiles.push(prev);
            tile.groups.forEach((id) => {
                if (!groups.has(id)) groups.set(id, []);
                groups.get(id)?.push(prev);
            });
        });

        // build a slider for each group
        groups.forEach((tiles, groupdId) => {
            // sweep-line algorithm to check if it is a horizontal group
            let lines = tiles
                .flatMap((t) => [
                    {
                        c: Math.round(t.tile.x * 1000) / 1000,
                        end: false,
                        r: t.rect.x,
                    },
                    {
                        c: Math.round((t.tile.x + t.tile.width) * 1000) / 1000,
                        end: true,
                        r: t.rect.x + t.rect.width,
                    },
                ])
                .sort((a, b) => (a.c - b.c !== 0 ? a.c - b.c : a.end ? -1 : 1));

            let count = 0;
            let coord = -1;
            let horizontal = false;
            for (const line of lines) {
                count += line.end ? -1 : 1;
                if (count === 0 && line !== lines[lines.length - 1]) {
                    coord = line.r;
                    horizontal = true;
                    break;
                }
            }

            if (coord === -1) {
                // sweep-line algorithm to check if it is a vertical group
                lines = tiles
                    .flatMap((t) => [
                        {
                            c: Math.round(t.tile.y * 1000) / 1000,
                            end: false,
                            r: t.rect.y,
                        },
                        {
                            c:
                                Math.round((t.tile.y + t.tile.height) * 1000) /
                                1000,
                            end: true,
                            r: t.rect.y + t.rect.height,
                        },
                    ])
                    .sort((a, b) =>
                        a.c - b.c !== 0 ? a.c - b.c : a.end ? -1 : 1,
                    );
                count = 0;
                for (const line of lines) {
                    count += line.end ? -1 : 1;
                    if (count === 0 && line !== lines[lines.length - 1]) {
                        coord = line.r;
                        break;
                    }
                }
            }

            if (coord === -1) {
                return;
            }

            const slider = this._buildSlider(horizontal, coord, groupdId);
            this._sliders.push(slider);
            tiles.forEach((editable) => slider.addTile(editable));
        });

        this._ensureSlidersOnTop();
    }

    private _buildEditableTile(
        tile: Tile,
        rect: Mtk.Rectangle,
    ): EditableTilePreview {
        const isOverlapping = tile.groups.length === 0;
        const gaps = buildTileGaps(
            rect,
            this._innerGaps,
            this._outerGaps,
            this._containerRect,
            1,
            isOverlapping,
        ).gaps;
        const editableTile = new EditableTilePreview({
            parent: this,
            tile,
            containerRect: this._containerRect,
            rect,
            gaps,
            innerGaps: this._innerGaps,
            outerGaps: this._outerGaps,
        });
        editableTile.open();
        editableTile.connect('clicked', (_, clicked_button: number) => {
            const [, , modifier] = global.get_pointer();
            const shiftPressed =
                (modifier & Clutter.ModifierType.SHIFT_MASK) !== 0;

            if (clicked_button === 1) {
                if (shiftPressed) {
                    const [x, y] = global.get_pointer();
                    this.addOverlappingTile(
                        (x - this.x) / this._containerRect.width,
                        (y - this.y) / this._containerRect.height,
                    );
                } else {
                    this.splitTile(editableTile);
                }
            } else if (clicked_button === 2) {
                this.cycleTileLayer(editableTile);
            } else if (clicked_button === 3) {
                this.deleteTile(editableTile);
            }
        });
        editableTile.connect('motion-event', (_, event: Clutter.Event) => {
            const [stageX, stageY] = getEventCoords(event);
            const [localX, localY] = editableTile.getLocalCoords(stageX, stageY);
            if (editableTile.isNearEdge(localX, localY)) {
                this._hoverWidget.hide();
                return Clutter.EVENT_PROPAGATE;
            }
            this._hoverWidget.handleMouseMove(
                editableTile,
                stageX - this.x,
                stageY - this.y,
            );
            return Clutter.EVENT_PROPAGATE;
        });
        editableTile.connect('notify::hover', () => {
            const [stageX, stageY] = Shell.Global.get().get_pointer();
            if (
                editableTile.isNearEdge(
                    stageX - editableTile.x,
                    stageY - editableTile.y,
                )
            ) {
                this._hoverWidget.hide();
                return;
            }
            this._hoverWidget.handleMouseMove(
                editableTile,
                stageX - this.x,
                stageY - this.y,
            );
        });
        if (this._sliders.length > 0)
            this.set_child_below_sibling(editableTile, this._sliders[0]);
        return editableTile;
    }

    private splitTile(editableTile: EditableTilePreview) {
        const oldTile = editableTile.tile;
        const index = this._layout.tiles.indexOf(oldTile);
        if (index < 0) return;

        const [x, y, modifier] = global.get_pointer();
        const splitX = (x - this.x) / this._containerRect.width;
        const splitY = (y - this.y) / this._containerRect.height;
        // split horizontally when CTRL is NOT pressed, split vertically instead
        const splitHorizontally =
            (modifier & Clutter.ModifierType.CONTROL_MASK) === 0;

        const prevTile = new Tile({
            x: oldTile.x,
            y: oldTile.y,
            width: splitHorizontally ? splitX - oldTile.x : oldTile.width,
            height: splitHorizontally ? oldTile.height : splitY - oldTile.y,
            groups: [],
        });

        const nextTile = new Tile({
            x: splitHorizontally ? splitX : oldTile.x,
            y: splitHorizontally ? oldTile.y : splitY,
            width: splitHorizontally
                ? oldTile.width - prevTile.width
                : oldTile.width,
            height: splitHorizontally
                ? oldTile.height
                : oldTile.height - prevTile.height,
            groups: [],
        });

        const prevRect = TileUtils.apply_props(prevTile, this._containerRect);
        const nextRect = TileUtils.apply_props(nextTile, this._containerRect);
        if (
            prevRect.height < EditableTilePreview.MIN_TILE_SIZE ||
            prevRect.width < EditableTilePreview.MIN_TILE_SIZE ||
            nextRect.height < EditableTilePreview.MIN_TILE_SIZE ||
            nextRect.width < EditableTilePreview.MIN_TILE_SIZE
        )
            return;

        this._layout.tiles[index] = prevTile;
        this._layout.tiles.push(nextTile);

        const prevEditableTile = this._buildEditableTile(prevTile, prevRect);
        const nextEditableTile = this._buildEditableTile(nextTile, nextRect);
        this._editableTiles = this._editableTiles.filter(
            (t) => t !== editableTile,
        );
        this._editableTiles.push(prevEditableTile, nextEditableTile);

        const slider = this._buildSlider(
            splitHorizontally,
            splitHorizontally
                ? nextEditableTile.rect.x
                : nextEditableTile.rect.y,
        );
        this._sliders.push(slider);
        slider.addTile(prevEditableTile);
        slider.addTile(nextEditableTile);

        if (splitHorizontally) {
            editableTile
                .getSlider(St.Side.TOP)
                ?.onTileSplit(editableTile, [
                    prevEditableTile,
                    nextEditableTile,
                ]);
            editableTile
                .getSlider(St.Side.BOTTOM)
                ?.onTileSplit(editableTile, [
                    prevEditableTile,
                    nextEditableTile,
                ]);
            editableTile
                .getSlider(St.Side.LEFT)
                ?.onTileSplit(editableTile, [prevEditableTile]);
            editableTile
                .getSlider(St.Side.RIGHT)
                ?.onTileSplit(editableTile, [nextEditableTile]);
        } else {
            editableTile
                .getSlider(St.Side.LEFT)
                ?.onTileSplit(editableTile, [
                    prevEditableTile,
                    nextEditableTile,
                ]);
            editableTile
                .getSlider(St.Side.RIGHT)
                ?.onTileSplit(editableTile, [
                    prevEditableTile,
                    nextEditableTile,
                ]);
            editableTile
                .getSlider(St.Side.TOP)
                ?.onTileSplit(editableTile, [prevEditableTile]);
            editableTile
                .getSlider(St.Side.BOTTOM)
                ?.onTileSplit(editableTile, [nextEditableTile]);
        }

        this._hoverWidget.handleTileDestroy(editableTile);
        editableTile.destroy();
        this._ensureSlidersOnTop();
    }

    private deleteTile(editableTile: EditableTilePreview) {
        if (this._layout.tiles.length <= 1) return;

        for (const slider of editableTile.getAllSliders()) {
            if (slider === null) continue;

            const success = slider.deleteSlider(
                editableTile,
                this._innerGaps,
                this._outerGaps,
            );
            if (success) {
                this._layout.tiles = this._layout.tiles.filter(
                    (tile) => tile !== editableTile.tile,
                );
                this._sliders = this._sliders.filter((sl) => sl !== slider);
                this._editableTiles = this._editableTiles.filter(
                    (t) => t !== editableTile,
                );
                this._hoverWidget.handleTileDestroy(editableTile);
                editableTile.destroy();
                slider.destroy();
                this._ensureSlidersOnTop();
                return;
            }
        }

        editableTile.detachFromAllSliders();
        this._layout.tiles = this._layout.tiles.filter(
            (tile) => tile !== editableTile.tile,
        );
        this._editableTiles = this._editableTiles.filter(
            (t) => t !== editableTile,
        );
        this._hoverWidget.handleTileDestroy(editableTile);
        editableTile.destroy();
        this._ensureSlidersOnTop();
    }

    private _buildSlider(
        isHorizontal: boolean,
        coord: number,
        groupId?: number,
    ): Slider {
        if (!groupId) {
            const groups = this._sliders.map((slider) => slider.groupId).sort();
            groupId = groups.length === 0 ? 1 : groups[groups.length - 1] + 1;
            for (let i = 1; i < groups.length; i++) {
                if (groups[i - 1] + 1 < groups[i]) {
                    groupId = groups[i - 1] + 1;
                    break;
                }
            }
        }
        return new Slider(this, groupId, coord, coord, isHorizontal);
    }

    private _onDestroy() {
        this._minimizedWindows.forEach((win) => win.unminimize());

        this.destroy_all_children();
        this._sliders = [];

        super.destroy();
    }
}
