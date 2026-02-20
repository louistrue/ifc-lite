/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BimContext — the main `bim` object.
 *
 * All SDK access goes through this object:
 *   const bim = createBimContext({ backend })
 *   bim.model.list()
 *   bim.query.create().byType('IfcWall').toArray()
 *   bim.viewer.colorize(refs, '#ff0000')
 */

import type { BimBackend, BimContextOptions, Transport, EntityData, EntityRef, PropertySetData, QuantitySetData } from './types.js';
import { ModelNamespace } from './namespaces/model.js';
import { QueryNamespace, QueryBuilder } from './namespaces/query.js';
import { ViewerNamespace } from './namespaces/viewer.js';
import { MutateNamespace } from './namespaces/mutate.js';
import { LensNamespace } from './namespaces/lens.js';
import { ExportNamespace } from './namespaces/export.js';
import { IDSNamespace } from './namespaces/ids.js';
import { BCFNamespace } from './namespaces/bcf.js';
import { DrawingNamespace } from './namespaces/drawing.js';
import { ListNamespace } from './namespaces/list.js';
import { SpatialNamespace } from './namespaces/spatial.js';
import { EventsNamespace } from './namespaces/events.js';
import { RemoteBackend } from './transport/remote-backend.js';

export class BimContext {
  readonly model: ModelNamespace;
  readonly viewer: ViewerNamespace;
  readonly mutate: MutateNamespace;
  readonly lens: LensNamespace;
  readonly export: ExportNamespace;
  readonly ids: IDSNamespace;
  readonly bcf: BCFNamespace;
  readonly drawing: DrawingNamespace;
  readonly list: ListNamespace;
  readonly spatial: SpatialNamespace;
  readonly events: EventsNamespace;

  private _queryNamespace: QueryNamespace;
  private _backend: BimBackend;
  private _boundOn: EventsNamespace['on'];

  constructor(options: BimContextOptions) {
    if (options.backend) {
      this._backend = options.backend;
    } else if (options.transport) {
      this._backend = new RemoteBackend(options.transport);
    } else {
      throw new Error('BimContext requires either a backend or transport');
    }

    this.model = new ModelNamespace(this._backend);
    this._queryNamespace = new QueryNamespace(this._backend);
    this.viewer = new ViewerNamespace(this._backend);
    this.mutate = new MutateNamespace(this._backend);
    this.lens = new LensNamespace();
    this.export = new ExportNamespace(this._backend);
    this.ids = new IDSNamespace();
    this.bcf = new BCFNamespace();
    this.drawing = new DrawingNamespace();
    this.list = new ListNamespace();
    this.spatial = new SpatialNamespace(this._backend);
    this.events = new EventsNamespace(this._backend);
    // Cache the bound function so every access returns the same reference
    this._boundOn = this.events.on.bind(this.events);
  }

  /**
   * Start a new query chain.
   *
   * Usage:
   *   bim.query().byType('IfcWall').where('Pset_WallCommon', 'IsExternal', '=', true).toArray()
   */
  query(): QueryBuilder {
    return this._queryNamespace.create();
  }

  /**
   * Get a single entity by reference.
   */
  entity(ref: EntityRef): EntityData | null {
    return this._queryNamespace.entity(ref);
  }

  /**
   * Get all property sets for an entity.
   */
  properties(ref: EntityRef): PropertySetData[] {
    return this._queryNamespace.properties(ref);
  }

  /**
   * Get all quantity sets for an entity.
   */
  quantities(ref: EntityRef): QuantitySetData[] {
    return this._queryNamespace.quantities(ref);
  }

  /**
   * Subscribe to an event.
   *
   * Usage:
   *   bim.on('selection:changed', ({ refs }) => console.log(refs))
   */
  get on(): EventsNamespace['on'] {
    return this._boundOn;
  }
}

/**
 * Create a BimContext.
 *
 * Local mode (viewer-embedded):
 *   const bim = createBimContext({ backend: myLocalBackend })
 *
 * Remote mode (connected to viewer):
 *   const bim = createBimContext({ transport: myBroadcastTransport })
 */
export function createBimContext(options: BimContextOptions): BimContext {
  return new BimContext(options);
}
