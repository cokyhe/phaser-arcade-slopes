/**
 * @author Chris Andrew <chris@hexus.io>
 * @copyright 2016-2017 Chris Andrew
 * @license MIT
 */

/**
 * Restrains SAT tile collision handling based on their neighbouring tiles.
 *
 * Can separate on a tile's preferred axis if it has one.
 *
 * This is what keeps the sloped tile collisions smooth for AABBs.
 * 
 * Think of it as the equivalent of the Arcade Physics tile face checks for all
 * of the sloped tiles and their possible neighbour combinations.
 *
 * Thanks to some painstaking heuristics, it allows a set of touching tiles to
 * behave more like a single shape.
 * 
 * TODO: Change all of these rules to work with Phaser's own edge restraints.
 *       Will require checking all of these rules during tilemap convert.
 *       TileSlope specific edge flags would need to be set for this.
 *       See SatSolver.shouldSeparate(). That should deal with it.
 *       This would work because we're only trying to prevent
 *       axis-aligned overlap vectors, not anything else.
 *
 * TODO: Move away from these heuristics and start flagging edge visibility
 *       automatically, if that could at all work out as well as this has.
 *       Imagine using the normals of each face to prevent separation on
 *       that axis, and instead using the next shortest axis to collide.
 *       TL;DR: Disable separation on the normals of internal faces
 *       by flagging them and further customising SAT.js.
 * 
 * @class Phaser.Plugin.ArcadeSlopes.SatRestrainer
 * @constructor
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer = function () {
	/**
	 * Restraint definitions for SAT collision handling.
	 *
	 * Each restraint is an array of rules, keyed by a corresponding tile type.
	 *
	 * Each rule defines a neighbour to check, overlap ranges to match and
	 * optionally neighbouring tile slope types to match (the same type is used
	 * otherwise). The separate property determines whether to attempt to
	 * collide on the tile's preferred axis, if there is one.
	 * 
	 * Schema:
	 *   [
	 *     {
	 *       neighbour: 'above'|'below'|'left'|'right'|'topLeft'|'topRight'|'bottomLeft'|'bottomRight'
	 *       overlapX:  {integer}|[{integer}, {integer}]
	 *       overlapY:  {integer}|[{integer}, {integer}]
	 *       types:     {array of neighbour TileSlope type constants}
	 *       separate:  {boolean|function(body, tile, response)}
	 *    },
	 *    {
	 *      ...
	 *    }
	 *  ]
	 *
	 * Shorthand schema:
	 *   [
	 *     {
	 *       neighbour: 'above'|'below'|'left'|'right'|'topLeft'|'topRight'|'bottomLeft'|'bottomRight'
	 *       direction: 'up'|'down'|'left'|'right'
	 *       types:     {array of neighbour TileSlope type constants}
	 *       separate:  {boolean=true|function(body, tile, response)}
	 *     },
	 *     {
	 *       ...
	 *     }
	 *   ]
	 *
	 * @property {object} restraints
	 */
	this.restraints = {};
	
	/**
	 * A reusable separation axis vector.
	 * 
	 * @property {SAT.Vector} separationAxis
	 */
	this.separationAxis = new SAT.Vector();
	
	// Define all of the default restraints
	this.setDefaultRestraints();
};

/**
 * Restrain the given SAT body-tile collision context based on the set rules.
 *
 * Returns false if the collision is handled by a restraint condition, either
 * triggering separation itself in the best case or skipping it entirely in the
 * worst case.
 * 
 * @method Phaser.Plugin.ArcadeSlopes.SatRestrainer#restrain
 * @param  {Phaser.Plugin.ArcadeSlopes.SatSolver} solver   - The SAT solver.
 * @param  {Phaser.Physics.Arcade.Body}           body     - The physics body.
 * @param  {Phaser.Tile}                          tile     - The tile.
 * @param  {SAT.Response}                         response - The initial collision response.
 * @return {boolean}                                       - Whether to continue collision handling.
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.prototype.restrain = function (solver, body, tile, response) {
	// Bail out if there's no overlap, no neighbours, or no tile type restraint
	if (!response.overlap || !tile.neighbours || !this.restraints.hasOwnProperty(tile.slope.type)) {
		return true;
	}

	for (var r in this.restraints[tile.slope.type]) {
		var rule = this.restraints[tile.slope.type][r];
		
		var neighbour = tile.neighbours[rule.neighbour];
		
		if (!(neighbour && neighbour.slope)) {
			continue;
		}
		
		// Restrain based on the same tile type by default
		var condition = false;
		
		if (rule.types) {
			condition = rule.types.indexOf(neighbour.slope.type) > -1;
		} else {
			condition = neighbour.slope.type === tile.slope.type;
		}
		
		// Restrain based on the overlapN.x value
		if (rule.hasOwnProperty('overlapX')) {
			if (typeof rule.overlapX === 'number') {
				condition = condition && response.overlapN.x === rule.overlapX;
			} else {
				condition = condition && response.overlapN.x >= rule.overlapX[0] && response.overlapN.x <= rule.overlapX[1];
			}
		}
		
		// Restrain based on the overlapN.y value
		if (rule.hasOwnProperty('overlapY')) {
			if (typeof rule.overlapY === 'number') {
				condition = condition && response.overlapN.y === rule.overlapY;
			} else {
				condition = condition && response.overlapN.y >= rule.overlapY[0] && response.overlapN.y <= rule.overlapY[1];
			}
		}
		
		// Return false if the restraint condition has been matched
		if (condition) {
			var separate = rule.separate;
			
			// Resolve the restraint separation decision if it's a function
			if (typeof separate === 'function') {
				separate = separate.call(this, body, tile, response);
			}
			
			// Separate on the tile's preferred axis by default
			var separationAxis = tile.slope.axis;
			
			// Use the restraint decision as the axis if it's a vector
			if (separate instanceof SAT.Vector) {
				separationAxis = separate;
			}
			
			// Collide on the separation axis if desired and available
			if (separate && separationAxis) {
				solver.collideOnAxis(body, tile, separationAxis);
			}
			
			return false;
		}
	}
	
	return true;
};

/**
 * Resolve overlapX and overlapY restraints from the given direction string.
 *
 * @static
 * @method Phaser.Plugin.ArcadeSlopes.SatRestrainer#resolveOverlaps
 * @param  {string} direction
 * @return {object}
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.resolveOverlaps = function (direction) {
	switch (direction) {
		case 'up':
			return {
				overlapX: 0,
				overlapY: [-1, 0]
			};
		case 'down':
			return {
				overlapX: 0,
				overlapY: [0, 1]
			};
		case 'left':
			return {
				overlapX: [-1, 0],
				overlapY: 0
			};
		case 'right':
			return {
				overlapX: [0, 1],
				overlapY: 0
			};
		case 'any':
			return {};
	}
	
	console.warn('Unknown overlap direction \'' + direction + '\'');
	
	return {};
};

/**
 * Formalizes the given informally defined restraints.
 *
 * Converts direction properties into overlapX and overlapY properties and
 * tile type strings into tile type constants.
 *
 * This simply allows for more convenient constraint definitions.
 *
 * @static
 * @method Phaser.Plugin.ArcadeSlopes.SatRestrainer#createRestraints
 * @param  {object}        restraints - The restraints to prepare.
 * @return {object}                   - The prepared restraints.
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.prepareRestraints = function (restraints) {
	var prepared = {};
	
	for (var type in restraints) {
		var restraint = restraints[type];
		
		// Resolve each rule in the restraint
		for (var r in restraint) {
			var rule = restraint[r];
			
			// Resolve overlapX and overlapY restraints from a direction
			if (rule.direction) {
				var resolved = Phaser.Plugin.ArcadeSlopes.SatRestrainer.resolveOverlaps(rule.direction);
				
				if (resolved.hasOwnProperty('overlapX')) {
					rule.overlapX = resolved.overlapX;
				}
				
				if (resolved.hasOwnProperty('overlapY')) {
					rule.overlapY = resolved.overlapY;
				}
			}
			
			// Resolve neighbour types from their string representations
			for (var nt in rule.types) {
				rule.types[nt] = Phaser.Plugin.ArcadeSlopes.TileSlope.resolveType(rule.types[nt]);
			}
			
			// Conveniently set separate to true unless it's already false or
			// it's a function that resolves a separation decision
			if (rule.separate !== false && typeof rule.separate !== 'function') {
				rule.separate = true;
			}
		}
		
		var restraintType = Phaser.Plugin.ArcadeSlopes.TileSlope.resolveType(type);
		
		prepared[restraintType] = restraint;
	}
	
	return prepared;
};

/**
 * Eagerly separate a body from a square tile.
 * 
 * This is used for full tile separation constraints to avoid tiny bodies
 * slipping between tile seams.
 *
 * Ignores any non-colliding or internal edges.
 * 
 * Returns a desired axis to separate on, if it can.
 * 
 * @param  {Phaser.Physics.Arcade.Body} body     - The physics body.
 * @param  {Phaser.Tile}                tile     - The tile.
 * @param  {SAT.Response}               response - The initial collision response.
 * @return {SAT.Vector|boolean}
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.prototype.fullTileSeparation = function (body, tile, response) {
	// If the body is above the tile center and top collisions are allowed,
	// and we're moving down, and more vertically than horizontally
	if (body.top < tile.worldY + tile.centerY && tile.collideUp && tile.slope.edges.top !== Phaser.Plugin.ArcadeSlopes.TileSlope.EMPTY && body.velocity.y > 0 && Math.abs(body.velocity.y) > Math.abs(body.velocity.x)) {
		this.separationAxis.x = 0;
		this.separationAxis.y = -1;
		
		return this.separationAxis;
	}
	
	// If the body is below the tile center and bottom collisions are allowed,
	// and we're moving up, and more vertically than horizontally
	if (body.bottom > tile.worldY + tile.centerY && tile.collideDown && tile.slope.edges.bottom !== Phaser.Plugin.ArcadeSlopes.TileSlope.EMPTY && body.slopes.velocity.y < 0 && Math.abs(body.slopes.velocity.y) > Math.abs(body.slopes.velocity.x)) {
		this.separationAxis.x = 0;
		this.separationAxis.y = 1;
		
		return this.separationAxis;
	}
	
	// If the body is left of the tile center and left collisions are allowed,
	// and we're moving right, and more horizontally than vertically
	if (body.left < tile.worldX + tile.centerX && tile.collideLeft && tile.slope.edges.left !== Phaser.Plugin.ArcadeSlopes.TileSlope.EMPTY && body.slopes.velocity.x > 0 && Math.abs(body.slopes.velocity.x) > Math.abs(body.slopes.velocity.y)) {
		this.separationAxis.x = -1;
		this.separationAxis.y = 0;
		
		return this.separationAxis;
	}
	
	// If the body is right of the tile center and right collisions are allowed,
	// and we're moving left, and more horizontally than vertically
	if (body.right > tile.worldX + tile.centerX && tile.collideRight && tile.slope.edges.right !== Phaser.Plugin.ArcadeSlopes.TileSlope.EMPTY && body.slopes.velocity.x < 0 && Math.abs(body.slopes.velocity.x) > Math.abs(body.slopes.velocity.y)) {
		this.separationAxis.x = 1;
		this.separationAxis.y = 0;
		
		return this.separationAxis;
	}
	
	// Otherwise separate normally
	return true;
};

/**
 * Set all of the default SAT collision handling restraints.
 *
 * These are the informally defined hueristics that get refined and utilised
 * above.
 *
 * They were cumbersome to write but they definitely pay off.
 *
 * @method Phaser.Plugin.ArcadeSlopes.SatRestrainer#setDefaultRestraints
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.prototype.setDefaultRestraints = function () {
	var restraints = {};
	
	restraints.FULL = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottomLeft', 'bottomRight'),
			separate: this.fullTileSeparation
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('topLeft', 'topRight'),
			separate: this.fullTileSeparation
		},
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('topRight', 'bottomRight'),
			separate: this.fullTileSeparation
		},
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('topLeft', 'bottomLeft'),
			separate: this.fullTileSeparation
		}
	];
	
	restraints.HALF_TOP = [
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('topRight', 'right'),
			separate: false
		},
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('topLeft', 'left'),
			separate: false
		}
	];

	restraints.HALF_BOTTOM = [
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('right', 'bottomRight'),
			separate: false
		},
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('left', 'bottomLeft'),
			separate: false
		}
	];

	restraints.HALF_LEFT = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottomLeft', 'bottom'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('topLeft', 'top'),
			separate: false
		}
	];

	restraints.HALF_RIGHT = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottom', 'bottomRight'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('top', 'topRight'),
			separate: false
		}
	];

	restraints.HALF_BOTTOM_LEFT = [
		{
			direction: 'right',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		},
		{
			direction: 'up',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		}
	];

	restraints.HALF_BOTTOM_RIGHT = [
		{
			direction: 'left',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight'),
		},
		{
			direction: 'up',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		}
	];

	restraints.HALF_TOP_LEFT = [
		{
			direction: 'right',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		},
		{
			direction: 'down',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight')
		}
	];

	restraints.HALF_TOP_RIGHT = [
		{
			direction: 'left',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		},
		{
			direction: 'down',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		}
	];

	restraints.QUARTER_BOTTOM_LEFT_LOW = [
		{
			direction: 'right',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		},
		{
			direction: 'up',
			neighbour: 'left',
			types: this.resolve('topLeft', 'right', 'bottomRight')
		},
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('right', 'bottomRight'),
			separate: false
		}
	];

	restraints.QUARTER_BOTTOM_LEFT_HIGH = [
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('left', 'bottomLeft'),
			separate: function (body, tile) {
				return body.bottom < tile.bottom;
			}
		},
		{
			direction: 'up',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		}
	];

	restraints.QUARTER_BOTTOM_RIGHT_LOW = [
		{
			direction: 'left',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight')
		},
		{
			direction: 'up',
			neighbour: 'right',
			types: this.resolve('topRight', 'left', 'bottomLeft')
		},
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('left', 'bottomLeft'),
			separate: false
		}
	];

	restraints.QUARTER_BOTTOM_RIGHT_HIGH = [
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('right', 'bottomRight'),
			separate: function (body, tile) {
				return body.bottom < tile.bottom;
			}
		},
		{
			direction: 'up',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		}
	];
	
	restraints.QUARTER_LEFT_BOTTOM_LOW = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottomLeft', 'bottom'),
			separate: function (body, tile) {
				return body.left > tile.left;
			}
		},
		{
			direction: 'right',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		}
	];
	
	restraints.QUARTER_LEFT_BOTTOM_HIGH = [
		{
			direction: 'up',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('topLeft', 'top'),
			separate: false
		},
		{
			direction: 'right',
			neighbour: 'below',
			types: this.resolve('topLeft', 'top', 'bottomRight')
		}
	];
	
	restraints.QUARTER_RIGHT_BOTTOM_LOW = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottom', 'bottomRight'),
			separate: function (body, tile) {
				return body.right < tile.right;
			}
		},
		{
			direction: 'left',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight')
		}
	];
	
	restraints.QUARTER_RIGHT_BOTTOM_HIGH = [
		{
			direction: 'up',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('top', 'topRight'),
			separate: false
		},
		{
			direction: 'left',
			neighbour: 'below',
			types: this.resolve('top', 'topRight', 'bottomLeft')
		}
	];
	
	restraints.QUARTER_LEFT_TOP_LOW = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottomLeft', 'bottom')
		},
		{
			direction: 'right',
			neighbour: 'above',
			types: this.resolve('bottomLeft', 'bottom'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight')
		}
	];
	
	restraints.QUARTER_LEFT_TOP_HIGH = [
		{
			direction: 'right',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('topLeft', 'top'),
			separate: function (body, tile) {
				return body.left > tile.left;
			}
		}
	];
	
	restraints.QUARTER_RIGHT_TOP_LOW = [
		{
			direction: 'up',
			neighbour: 'above',
			types: this.resolve('bottom', 'bottomRight')
		},
		{
			direction: 'left',
			neighbour: 'above',
			types: this.resolve('bottom', 'bottomRight'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		}
	];
	
	restraints.QUARTER_RIGHT_TOP_HIGH = [
		{
			direction: 'left',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		},
		{
			direction: 'down',
			neighbour: 'below',
			types: this.resolve('top', 'topRight'),
			separate: function (body, tile) {
				return body.right < tile.right;
			}
		}
	];
	
	restraints.QUARTER_TOP_LEFT_LOW = [
		{
			direction: 'right',
			neighbour: 'topRight',
			types: this.resolve('bottomLeft')
		},
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('topRight', 'right'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'left',
			types: this.resolve('bottomLeft', 'topRight', 'right')
		}
	];
	
	restraints.QUARTER_TOP_LEFT_HIGH = [
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('topLeft', 'left'),
			separate: function (body, tile) {
				return body.top > tile.top;
			}
		},
		{
			direction: 'down',
			neighbour: 'bottomLeft',
			types: this.resolve('topRight')
		}
	];
	
	restraints.QUARTER_TOP_RIGHT_LOW = [
		{
			direction: 'left',
			neighbour: 'topLeft',
			types: this.resolve('bottomRight')
		},
		{
			direction: 'right',
			neighbour: 'right',
			types: this.resolve('topLeft', 'left'),
			separate: false
		},
		{
			direction: 'down',
			neighbour: 'right',
			types: this.resolve('bottomRight', 'topLeft', 'left')
		}
	];
	
	restraints.QUARTER_TOP_RIGHT_HIGH = [
		{
			direction: 'left',
			neighbour: 'left',
			types: this.resolve('topRight', 'right'),
			separate: function (body, tile) {
				return body.top > tile.top;
			}
		},
		{
			direction: 'down',
			neighbour: 'bottomRight',
			types: this.resolve('topLeft')
		}
	];
	
	// Keep a copy of the informal restraints for inspection
	this.informalRestraints = JSON.parse(JSON.stringify(restraints));
	
	this.restraints = Phaser.Plugin.ArcadeSlopes.SatRestrainer.prepareRestraints(restraints);
};

/**
 * Compute the intersection of two arrays.
 * 
 * Returns a unique set of values that exist in both arrays.
 *
 * @method Phaser.Plugin.ArcadeSlopes.SatRestrainer#intersectArrays
 * @param  {array} a - The first array.
 * @param  {array} b - The second array.
 * @return {array}   - The unique set of values shared by both arrays.
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.intersectArrays = function (a, b) {
	return a.filter(function (value) {
		return b.indexOf(value) !== -1;
	}).filter(function (value, index, array) {
		return array.indexOf(value) === index;
	});
};

/**
 * Resolve the types of all tiles with vertices in all of the given locations.
 *
 * Locations can be:
 *   'topLeft',    'top',       'topRight',
 *   'left',                       'right',
 *   'bottomLeft', 'bottom', 'bottomRight'
 * 
 * @method Phaser.Plugin.ArcadeSlopes.TileSlopeFactory#resolve
 * @param  {...string} locations - A set of AABB vertex locations as strings.
 * @return {array}               - The tile slope types with matching vertices.
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.prototype.resolve = function () {
	var types = [];
	
	if (!arguments.length) {
		return types;
	}
	
	// Check the vertex maps of the given locations
	for (var l in arguments) {
		var location = arguments[l];
		
		if (!Phaser.Plugin.ArcadeSlopes.SatRestrainer.hasOwnProperty(location + 'Vertices')) {
			console.warn('Tried to resolve types from undefined vertex map location \'' + location + '\'');
			continue;
		}
		
		var vertexMap = Array.prototype.slice.call(Phaser.Plugin.ArcadeSlopes.SatRestrainer[location + 'Vertices']);
		
		// If we only have one location to match, we can return its vertex map
		if (arguments.length === 1) {
			return vertexMap;
		}
		
		// If we don't have any types yet, use this vertex map to start with,
		// otherwise intersect this vertex map with the current types
		if (!types.length) {
			types = vertexMap;
		} else {
			types = Phaser.Plugin.ArcadeSlopes.SatRestrainer.intersectArrays(types, vertexMap);
		}
	}
	
	return types;
};

// TODO: Automate these definitions instead of relying on tedious heuristics.
//       Store them in a single vertexMaps property object, too.

/**
 * The set of tile slope types with a top center vertex.
 *
 * @static
 * @property {array} topVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.topVertices = [
	'HALF_LEFT',
	'HALF_RIGHT',
	'QUARTER_LEFT_TOP_LOW',
	'QUARTER_RIGHT_TOP_LOW',
	'QUARTER_LEFT_BOTTOM_LOW',
	'QUARTER_RIGHT_BOTTOM_LOW'
];

/**
 * The set of tile slope types with a bottom center vertex.
 *
 * @static
 * @property {array} bottomVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.bottomVertices = [
	'HALF_LEFT',
	'HALF_RIGHT',
	'QUARTER_LEFT_TOP_HIGH',
	'QUARTER_LEFT_BOTTOM_HIGH',
	'QUARTER_RIGHT_TOP_HIGH',
	'QUARTER_RIGHT_BOTTOM_HIGH'
];

/**
 * The set of tile slope types with a left center vertex.
 *
 * @static
 * @property {array} leftVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.leftVertices = [
	'HALF_TOP',
	'HALF_BOTTOM',
	'QUARTER_TOP_LEFT_LOW',
	'QUARTER_TOP_RIGHT_HIGH',
	'QUARTER_BOTTOM_LEFT_LOW',
	'QUARTER_BOTTOM_RIGHT_HIGH'
];

/**
 * The set of tile slope types with a right center vertex.
 *
 * @static
 * @property {array} rightVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.rightVertices = [
	'HALF_TOP',
	'HALF_BOTTOM',
	'QUARTER_TOP_LEFT_HIGH',
	'QUARTER_TOP_RIGHT_LOW',
	'QUARTER_BOTTOM_LEFT_HIGH',
	'QUARTER_BOTTOM_RIGHT_LOW',
];

/**
 * The set of tile slope types with a top left vertex.
 *
 * @static
 * @property {array} topLeftVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.topLeftVertices = [
	'FULL',
	'HALF_TOP',
	'HALF_LEFT',
	'HALF_TOP_LEFT',
	'HALF_TOP_RIGHT',
	'HALF_BOTTOM_LEFT',
	'QUARTER_TOP_LEFT_LOW',
	'QUARTER_TOP_LEFT_HIGH',
	'QUARTER_TOP_RIGHT_HIGH',
	'QUARTER_BOTTOM_LEFT_HIGH',
	'QUARTER_LEFT_TOP_LOW',
	'QUARTER_LEFT_TOP_HIGH',
	'QUARTER_LEFT_BOTTOM_LOW',
	'QUARTER_LEFT_BOTTOM_HIGH',
	'QUARTER_RIGHT_TOP_HIGH'
];

/**
 * The set of tile slope types with a top right vertex.
 *
 * @static
 * @property {array} topRightVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.topRightVertices = [
	'FULL',
	'HALF_TOP',
	'HALF_RIGHT',
	'HALF_TOP_LEFT',
	'HALF_TOP_RIGHT',
	'HALF_BOTTOM_RIGHT',
	'QUARTER_TOP_LEFT_LOW',
	'QUARTER_TOP_LEFT_HIGH',
	'QUARTER_TOP_RIGHT_LOW',
	'QUARTER_TOP_RIGHT_HIGH',
	'QUARTER_BOTTOM_RIGHT_HIGH',
	'QUARTER_LEFT_TOP_HIGH',
	'QUARTER_RIGHT_TOP_LOW',
	'QUARTER_RIGHT_TOP_HIGH',
	'QUARTER_RIGHT_BOTTOM_LOW',
	'QUARTER_RIGHT_BOTTOM_HIGH'
];

/**
 * The set of tile slope types with a bottom left vertex.
 *
 * @static
 * @property {array} bottomLeftVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.bottomLeftVertices = [
	'FULL',
	'HALF_LEFT',
	'HALF_BOTTOM',
	'HALF_TOP_LEFT',
	'HALF_BOTTOM_LEFT',
	'HALF_BOTTOM_RIGHT',
	'QUARTER_TOP_LEFT_HIGH',
	'QUARTER_BOTTOM_LEFT_LOW',
	'QUARTER_BOTTOM_LEFT_HIGH',
	'QUARTER_BOTTOM_RIGHT_LOW',
	'QUARTER_BOTTOM_RIGHT_HIGH',
	'QUARTER_LEFT_TOP_HIGH',
	'QUARTER_LEFT_BOTTOM_LOW',
	'QUARTER_LEFT_BOTTOM_HIGH',
	'QUARTER_RIGHT_BOTTOM_LOW'
];

/**
 * The set of tile slope types with a bottom right vertex.
 *
 * @static
 * @property {array} bottomRightVertices
 */
Phaser.Plugin.ArcadeSlopes.SatRestrainer.bottomRightVertices = [
	'FULL',
	'HALF_RIGHT',
	'HALF_BOTTOM',
	'HALF_TOP_RIGHT',
	'HALF_BOTTOM_LEFT',
	'HALF_BOTTOM_RIGHT',
	'QUARTER_TOP_RIGHT_HIGH',
	'QUARTER_BOTTOM_LEFT_LOW',
	'QUARTER_BOTTOM_LEFT_HIGH',
	'QUARTER_BOTTOM_RIGHT_LOW',
	'QUARTER_BOTTOM_RIGHT_HIGH',
	'QUARTER_LEFT_BOTTOM_LOW',
	'QUARTER_RIGHT_TOP_HIGH',
	'QUARTER_RIGHT_BOTTOM_LOW',
	'QUARTER_RIGHT_BOTTOM_HIGH'
];
