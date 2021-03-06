import scatterplot_webgl from "./scatterplot_webgl";
import splatterplot from "./scatterplot_components/splatterplot";

import points from "./scatterplot_components/points";
import bins from "./scatterplot_components/bins";

export default function(dispatch) {
  // 'global' declarations go here
  var rendering = 'svg';
  var selectionName = undefined;
  var scatterData = [];
  var scatterDataKey = undefined;
  var localDispatch = d3.dispatch('mouseover', 'mouseout', 'mousedown', 'click');
  var visType = points;
  
  var width = 1;
  var height = 1;
  var xValue = function(d) { return +d[0]; }; // the x-value selector
  var yValue = function(d) { return +d[1]; }; // the y-value selector
  var scale = { x: undefined, y: undefined }; // holds the x- and y-axis scales
  var bounds = [[], []];  // holds the current bounds; usually ahead of scale (see `setGlobals`)
  var name = ["", ""];    // holds the current x- and y-axis labels 

  var availableFields = [];
  var areFieldsSet = false;
  
  var grpValue = null;          // the groupValue selector
  var foundGroups = ["undefined"];
  
  var ptSize = 3;
  var colorScale = null;        // maps grpValue to a color
  var ptIdentifier = function(d, i) { return "" + d.orig_index; };
  var hiddenClass = "point-hidden";
  
  var doBrush = false;          // should we add a brush?
  var doVoronoi = false;        // should we construct a voronoi overlay?
  var doZoom = false;           // should we support zoom+pan?
  var doLimitMouse = false;     // should we limit mouse interaction to highlighted pts only?
  var autoBounds = true;        // should we auto-scale the graph if data selectors change?
  var hiddenSupress = true;     // should we supress mouse events for non-highlighted points?

  // holds global d3 objects
  var brush = undefined;
  var voronoi = undefined;
  var zoomBehavior = undefined;

  var distType = undefined;
  
  var duration = 500;           // the default d3.transition duration

  var isDirty = true;           // have data selectors or bounds changed?
  var selectorChanged = true;   // have data selectors changed? 
  var extScatterObj = undefined;// holds the external scatterplot component for this object 
  
  // the shared scales/groups needed by all rendering mechanisms
  function setGlobals(data) {
    // set the discovered groups
    foundGroups = grpValue == null ? 
      ["undefined"] : 
      d3.set(data.map(function(e) { return grpValue(e); })).values();
    console.log("found %d groups", foundGroups.length);
    
    // try to be smart about not clobbering color scales.  
    // if no color scale exists, create one and set the domain
    if (!colorScale) {
      colorScale = d3.scale.category10();
      colorScale.domain(foundGroups);
    } else {
      var existingDomain = colorScale.domain();
      
      // if one exists, and the foundGroups contains a superset of the scale domain, add the new groups
      foundGroups.forEach(function(grp) {
        if (existingDomain.indexOf(grp) == -1) {
          existingDomain.append(grp);
        }
      });

      colorScale.domain(existingDomain);
    }
    
    // regardless of what happens, make sure all color-based components are updated
    dispatch.groupUpdate(foundGroups, colorScale);
    
    if (scale.x === undefined) {
      scale.x = d3.scale.linear();
      scale.y = d3.scale.linear();
    } 
    
    // set the axes' domain, iff existing domain is empty OR 
    // data selectors have changed and representation should auto-scale
    if (!bounds[0].length || (selectorChanged && autoBounds)) {
      var xd = d3.extent(data, function(e) { return +xValue(e); });
      var yd = d3.extent(data, function(e) { return +yValue(e); }); 

      xd = xd.map(function(d, i) { 
        return d + (i % 2 == 0 ? -1 : 1) * ((xd[1] - xd[0]) / 20); 
      });
      yd = yd.map(function(d, i) { 
        return d + (i % 2 == 0 ? -1 : 1) * ((yd[1] - yd[0]) / 20); 
      });

      bounds = [xd, yd];
    }

    scale.x.range([0, width]).domain(bounds[0]);
    scale.y.range([height, 0]).domain(bounds[1]);
  };

  // shared code to generate voronois for the given points
  function generateVoronoi(selection, points) {
    selection.each(function() {
      var g = d3.select(this);

      // filter out the points that fall outside the bounds of the graph;
      // d3.voronoi doesn't really handle out-of-bounds points well
      points = points.filter(function(d) {
        var xd = scale.x.domain(), yd = scale.y.domain();
        return !(xd[0] > xValue(d) || xValue(d) > xd[1] ||
          yd[0] > yValue(d) || yValue(d) > yd[1]);
      });
      
      // (1) use selectAll() instead of select() to prevent setting data on 
      //     the selection from the selector
      // (2) by passing voronoi(points) through a no-op filter(), it removes 
      //     `undefined` indices returned by voronoi for points that failed 
      //     to have a cell created 
      var voronois = g.selectAll('g.voronoi')
        .selectAll('path')
        .data(voronoi(points).filter(function() { return true; }), function(d) { 
          return d.point ? d.point.orig_index : d.orig_index; 
        });
      voronois.enter().append('path')
        .attr('d', function(d) { return "M" + d.join('L') + "Z"; })
        .datum(function(d) { return d.point; })
        .attr('class', function(d) { return "voronoi-" + d.orig_index; })
        // .style('stroke', '#2074A0')
        .style('fill', 'none')
        .style('pointer-events', 'all')
        .on('mouseover', function(d) { 
          var pt = g.selectAll("#circle-" + d.orig_index);
          var ptPos = pt.node().getBoundingClientRect();
          // d3.select(this).style('fill', '#2074A0');
          if (localDispatch.hasOwnProperty('mouseover'))
            localDispatch.mouseover(d, ptPos);
        }).on('mouseout', function(d) {
          // d3.select(this).style('fill', 'none');
          if (localDispatch.hasOwnProperty('mouseout'))
            localDispatch.mouseout(d);
        }).on('mousedown', function(d) { 
          // if a brush is started over a point, hand it off to the brush
          // HACK from <http://stackoverflow.com/questions/37354411/>
          if (doBrush) {
            var e = brush.extent();
            var m = d3.mouse(selection.node());
            var p = [scale.x.invert(m[0]), scale.y.invert(m[1])];
            
            if (brush.empty() || e[0][0] > p[0] || p[0] > e[1][0] || e[0][1] > p[1] || p[1] > e[1][1]) {
              brush.extent([p,p]);
            } else {
              d3.select(this).classed('extent', true);
            }
          } else {
            if (localDispatch.hasOwnProperty('mousedown'))
              localDispatch.mousedown(d);
          }
        }).on('click', function(d) {
          if (localDispatch.hasOwnProperty('click') && !d3.event.defaultPrevented)
            localDispatch.click(d);
        });

      // update current voronois?
      voronois.each(function(d) {
        if (Array.isArray(d)) {
          d3.select(this).attr('d', "M" + d.join('L') + "Z")
            .datum(function(d) { return d.point; });
        }
      });

      voronois.exit().remove();
    });
  }
  
  function redrawSVG(selection) {
    console.log("called scatterplot.redrawSVG()");
    selection.each(function() {
      var g = d3.select(this);
      
      // set the scales and determine the groups and their colors
      setGlobals(scatterData);
      
      // construct a brush object for this selection 
      // (TODO / BUG: one brush for multiple graphs?)
      brush = d3.svg.brush()
        .x(scale.x)
        .y(scale.y)
        .on("brush", brushmove)
        .on("brushend", brushend);

      zoomBehavior = d3.behavior.zoom()
        .x(scale.x)
        .y(scale.y)
        .scaleExtent([0, 500])
        .on("zoom", zoom)
        .on("zoomstart", function(d) {
          if (localDispatch.hasOwnProperty('mouseout')) 
            localDispatch.mouseout(d);
        })
        .on("zoomend", function() {
          // update bounds object
          bounds = [scale.x.domain(), scale.y.domain()];
           
          if (doVoronoi) {            
            // if no points are hidden, don't draw voronois
            if (g.selectAll('circle.' + hiddenClass).size() !== 0) {
              // just select the points that are visible in the chartArea
              var activePoints;
              if (hiddenSupress) {
                var activePoints = chartArea.selectAll('circle.point')
                  .filter(function(d) {
                    return !d3.select(this).classed(hiddenClass);
                  }).data();
              } else {
                activePoints = scatterData;
              }

              // update the voronois
              g.call(generateVoronoi, activePoints);
            } else if (!doLimitMouse) {
              g.call(generateVoronoi, scatterData);
            }
          } 
        });
      
      // draw axes first so points can go over the axes
      var xaxis = g.selectAll('g.xaxis')
        .data([0]);
      
      // add axis if it doesn't exist  
      xaxis.enter()
        .append('g')
          .attr('class', 'xaxis axis')
          .attr('transform', 'translate(0, ' + height + ')')
          .call(d3.svg.axis().orient("bottom").scale(scale.x));
        
      var xLabel = xaxis.selectAll('text.alabel')
        .data([name[0]]);
        
      xLabel.enter().append('text')
        .attr('class', 'alabel')
        .attr('transform', 'translate(' + (width / 2) + ',20)')
        .attr('dy', '1em')
        .style('text-anchor', 'middle');
      xLabel.text(function(d) { return d; });
      xLabel.exit().remove();
        
      var yaxis = g.selectAll('g.yaxis')
        .data([0]);
        
      // add axis if it doesn't exist
      yaxis.enter()
        .append('g')
          .attr('class', 'yaxis axis')
          .call(d3.svg.axis().orient("left").scale(scale.y));
          
      var yLabel = yaxis.selectAll('text.alabel')
        .data([name[1]]);
      yLabel.enter().append('text')
        .attr('class', 'alabel')
        .attr('transform', 'rotate(-90)')
        .attr('y', -25)
        .attr('x', -(height / 2))
        .attr('dy', '-1em')
        .style('text-anchor', 'middle');
      yLabel.text(function(d) { return d; });
      yLabel.exit().remove();

      // create a group for the chart area, and clip anything that falls outside this
      // * this group lets us zoom/pan outside of objects in the graphs
      g.selectAll('g.chartArea')
        .data([1]).enter().append('g')
          .attr('class', 'chartArea')
          .style('pointer-events', 'all');
      var chartArea = g.select('g.chartArea');

      // set up a clipping mask for the chart area (specific to this selection)
      var thisNode = g.node();
      while ((thisNode = thisNode.parentNode).tagName != 'svg');
      d3.select(thisNode).selectAll('defs').data([1]).enter()
        .append('defs');
      d3.select(thisNode).select('defs')
        .selectAll('clipPath').data([selectionName], function(d) { return d }).enter()
          .append('clipPath')
            .attr('id', function(d) { return d; })
            .append('rect')
              .attr({x: 0, y: 0, width: width, height: height});
     chartArea.attr('clip-path', 'url(#' + selectionName + ')');

      // put the brush above the points to allow hover events; see 
      //   <http://wrobstory.github.io/2013/11/D3-brush-and-tooltip.html>
      //   and <http://bl.ocks.org/wrobstory/7612013> ..., but still have
      //   issues: <http://bl.ocks.org/yelper/d38ddf461a0175ebd927946d15140947>
      // RESOLVED: <http://stackoverflow.com/questions/37354411/>
      // create the brush group if it doesn't exist and is requested by `doBrush`
      var brushDirty = false;
      if (doBrush) {
        // remove the zoom-only background element
        chartArea.selectAll('rect.backgroundDrag').remove();

        // this will have no effect if brush elements are already in place
        chartArea.call(brush);
      } else {
        // if a brush WAS here, remove all traces of the brush and deactivate events
        if (!chartArea.selectAll('.background, .extent, .resize').empty()) {
          brushDirty = true;
          chartArea.style('pointer-events', null)
            .style('-webkit-tap-highlight-color', null);
          chartArea.selectAll('.background, .extent, .resize').remove();
          chartArea.on('mousedown.brush', null)
            .on('touchstart.brush', null);
        }

        // if zoom AND NOT brush, 
        // make a background element to capture clicks for zooming/panning
        if (doZoom) {
          chartArea.selectAll('rect.backgroundDrag')
            .data([1]).enter().append('rect')
              .attr('class', 'backgroundDrag')
              .attr({x: 0, y: 0, height: height, width: width})
              .style('visibility', 'hidden')
              .style('pointer-events', 'all');
        }
      }
      
      // deal with setting up the voronoi group
      var voronoiGroup = chartArea.selectAll('g.voronoi')
        .data(doVoronoi ? [0] : []);
      voronoiGroup.enter().append('g')
        .attr('class', 'voronoi');
      voronoiGroup.exit()
        .each(function(d) {
          if (localDispatch.hasOwnProperty('mouseout'))
            localDispatch.mouseout(d);
        })
        .remove();

      if (doZoom) {
        chartArea.call(zoomBehavior);
      }

      // the visType is set in rendering(); defaults to 'points' [scatterplot_components/points.js]
      // TODO: provide interface for users to provide and pass in their own scatterplot_component
      //        prototype class
      if (!extScatterObj) {
        extScatterObj = new visType({
          data: scatterData,
          scale: scale, 
          xValue: xValue, 
          yValue: yValue, 
          grpValue: grpValue, 
          foundGroups: foundGroups, 
          colorScale: colorScale,
          ptSize: ptSize,
          duration: duration,
          hiddenClass: hiddenClass
        });  
      }
      
      // finally, draw the points
      extScatterObj.draw(chartArea);

      // if requested, try to bind listeners to created visual objects (if they exist)
      chartArea.selectAll(extScatterObj.visualEncSelector())
        .on('mouseover', doVoronoi ? null : function(d) {
          var ptPos = this.getBoundingClientRect();
          if (localDispatch.hasOwnProperty('mouseover'))
            localDispatch.mouseover(d, ptPos);
        })
        .on('mouseout', doVoronoi ? null : function(d) {
          if (localDispatch.hasOwnProperty('mouseout'))
            localDispatch.mouseout(d);
        })
        .on('mousedown', function(d) {
          // if a brush is started over a point, hand it off to the brush
          // HACK from <http://stackoverflow.com/questions/37354411/>
          if (doBrush) {
            var e = brush.extent();
            var m = d3.mouse(g.node());
            var p = [scale.x.invert(m[0]), scale.y.invert(m[1])];
            
            if (brush.empty() || e[0][0] > xValue(d) || xValue(d) > e[1][0] ||
              e[0][1] > yValue(d) || yValue(d) > e[1][1])
            {
              brush.extent([p,p]);
            } else {
              d3.select(this).classed('extent', true);
            }
          } else {
            if (localDispatch.hasOwnProperty('mousedown'))
              localDispatch.mousedown(d);
          }
        })
        .on('click', function(d) {
          if (localDispatch.hasOwnProperty('click') && !d3.event.defaultPrevented)
            localDispatch.click(d);
        });

      // update axis if bounds changed
      g.selectAll('.xaxis')
        .transition().duration(duration)
        .call(d3.svg.axis().orient("bottom").scale(scale.x));
        
      g.selectAll('.yaxis')
        .transition().duration(duration)
        .call(d3.svg.axis().orient("left").scale(scale.y));

      if (doVoronoi) {
        voronoi = d3.geom.voronoi()
          .x(function(d) { return scale.x(xValue(d)); })
          .y(function(d) { return scale.y(yValue(d)); })
          .clipExtent([[0, 0], [width, height]]);

        if (!doLimitMouse)
          chartArea.call(generateVoronoi, scatterData);
      }

      // hack to clear selected points post-hoc after removing brush element 
      // (to get around inifinite-loop problem if called from within the exit() selection)
      if (brushDirty) dispatch.highlight(false);
        
      function brushmove(p) {
        var e = brush.extent();
        
        // TODO: I forgot why these lines are necessary... (does it have to do with brushes?)
        g.selectAll('circle').classed('extent', false);
        g.selectAll('.voronoi path').classed('extent', false);
        
        dispatch.highlight(function(d) { 
          return !(e[0][0] > xValue(d) || xValue(d) > e[1][0] || e[0][1] > yValue(d) || yValue(d) > e[1][1]);
        });
      }
      
      function brushend() {
        if (brush.empty()) {
          // destroy any remaining voronoi shapes
          g.selectAll('.voronoi').selectAll('path').remove();
          
          // destroys any lingering extent rectangles 
          // (can happen when passing mousemoves through voronoi layer)
          g.selectAll('.extent').attr('width', 0).attr('height', 0);
          
          // call any linked mouseout events to finalize brush removals
          // (e.g. hides tooltips when brush disappears and no highlighted points remain)
          if (localDispatch.hasOwnProperty('mouseout'))
            localDispatch.mouseout();
          
          // removes all highlights for all linked components 
          g.selectAll('.' + hiddenClass).classed(hiddenClass, false);
          dispatch.highlight(false);
        }
      }

      function zoom() {
        // updateGraph(true);
        extScatterObj.update(chartArea, true);

        g.selectAll('.xaxis')
          .call(d3.svg.axis().orient("bottom").scale(scale.x));
        g.selectAll('.yaxis')
          .call(d3.svg.axis().orient("left").scale(scale.y));
      };
    });
  };
  
  function redrawCanvas(selection) {
    console.log("called scatterplot.redrawCanvas()");
    selection.each(function() {
      // only support points so far
      var container = d3.select(this);
      setGlobals(scatterData);

      if (container.select('canvas').empty() && container.select('svg'))
        initializeCanvasSVGLayers(container);
      
      var canvas = container.select('canvas');
      if (!canvas.node().getContext){
        console.error("Your browser does not support the 2D canvas element; reverting to SVG");
        rendering = 'svg';
        redrawSVG();
      }
      
      var thisData = scatterData.concat(scatterData).concat(scatterData).concat(scatterData).concat(scatterData);

      // draw the points after clearing the canvas 
      var ctx = canvas.node().getContext('2d');
      ctx.clearRect(0, 0, width, height);
      renderPoints(thisData, ctx);
      
      // update the SVG overlay
      updateSVGOverlay(container);
    });
    
    // inspired by <http://bl.ocks.org/syntagmatic/2420080>
    function renderPoints(points, ctx, rate) {
      var n = points.length;
      var i = 0;
      rate = rate || 250;
      ctx.clearRect(0, 0, width, height);
      function render() {
        var max = Math.min(i + rate, n);
        points.slice(i, max).forEach(function(d) { 
          renderPoint(
            ctx, scale.x(xValue(d)), 
            scale.y(yValue(d)), colorScale(grpValue(d)));
        });
        i = max;
      };
      
      (function animloop() {
        if (i >= n) return;
        requestAnimationFrame(animloop);
        render();
      })();
    }
    
    function renderPoint(ctx, x, y, color) {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.moveTo(x, y);
      ctx.arc(x, y, ptSize, 0, 2 * Math.PI);
      ctx.fill();
    }
  };

  // only called when a canvas or SVG element is not found 
  // within the container element
  function initializeCanvasSVGLayers(container) {
    // remove all of this items svg/canvas elements
    container.select("svg, canvas").remove();

    // amount of space needed to draw items on the left margin 
    var leftMargin = 50;
    var bottomMargin = 50;

    // create a canvas node
    container.style('position', 'relative')
      .style('padding-bottom', bottomMargin + 'px');
    container.append('canvas')
      .attr('width', width)
      .attr('height', height)
      .style('margin-left', leftMargin + "px");

    var svg = container.append('svg')
      .attr('width', width + leftMargin)
      .attr('height', height + bottomMargin)
      .style('zIndex', 10)
      .style('position', 'absolute')
      .style('top', 0)
      .style('left', 0);

    svg.append('g')
      .attr('class', 'container')
      .attr('transform', 'translate(' + leftMargin + ',0)');
  }

  // initialize the SVG layer to capture mouse interaction; show brushes, axes, etc.
  function updateSVGOverlay(container, skipTransition) {
    skipTransition = !!skipTransition;

    var svg = container.select('svg');
    svg = svg.select('g.container');
    // brush = d3.svg.brush()
    //   .x(scale.x)
    //   .y(scale.y)
    //   .on('brush', brushmove)
    //   .on('brushend', brushend);

    var xaxis = svg.selectAll('g.xaxis')
      .data([0]);

    xaxis.enter()
      .append('g')
        .attr('class', 'xaxis axis')
        .attr('transform', 'translate(0, ' + height + ')')
        .call(d3.svg.axis().orient('bottom').scale(scale.x));

    var xLabel = xaxis.selectAll('text.alabel')
      .data([name[0]]);

    xLabel.enter().append('text')
      .attr('class', 'alabel')
      .attr('transform', 'translate(' + (width / 2) + ',20)')
      .attr('dy', '1em')
      .style('text-anchor', 'middle');
    xLabel.text(function(d) { return d; });
    xLabel.exit().remove();

    if (!skipTransition) xaxis = xaxis.transition().duration(duration);
    xaxis.attr('transform', 'translate(0,'+height+')')
      .call(d3.svg.axis().orient('bottom').scale(scale.x));

    var yaxis = svg.selectAll('g.yaxis')
      .data([0]);

    yaxis.enter()
      .append('g')
        .attr('class', 'yaxis axis')
        .call(d3.svg.axis().orient('left').scale(scale.y));

    var yLabel = yaxis.selectAll('text.alabel')
      .data([name[1]]);
    yLabel.enter()
      .append('text')
        .attr('class', 'alabel')
        .attr('transform', 'rotate(-90)')
        .attr('y', -25)
        .attr('x', -(height / 2))
        .attr('dy', '-1em')
        .style('text-anchor', 'middle')
    yLabel.text(function(d) { return d; });
    yLabel.exit().remove();

    if (!skipTransition) yaxis.transition().duration(duration);
    yaxis.call(d3.svg.axis().orient('left').scale(scale.y));

    // handle zooming
    zoomBehavior = d3.behavior.zoom()
      .x(scale.x)
      .y(scale.y)
      .scaleExtent([0, 500])
      .on("zoom", function(d) {
        // trigger a redraw
        // TODO: there's got to be a better way to select the container...
        render(d3.select(svg.node().parentNode.parentNode));
        console.log("zoom/pan -- x: " + bounds[0] + ", y: " + bounds[1]);
        bounds = [scale.x.domain(), scale.y.domain()];
      }).on("zoomstart", function(d) {
        if (localDispatch.hasOwnProperty('mouseout'))
          localDispatch.mouseout(d);
      });

    if (doZoom) {
      svg.selectAll('rect.backgroundDrag')
        .data([1]).enter().append('rect')
          .attr('class', 'backgroundDrag')
          .attr({x: 0, y: 0, height: height, width: width})
          .style('visibility', 'hidden')
          .style('pointer-events', 'all');
      svg.call(zoomBehavior);
    }
  }

  function redrawWebGL(selection) {
    console.log("called scatterplot.redrawWebGL()");
    selection.each(function() {
      var container = d3.select(this);
      
      // if context is not set up yet, set up DOM and internal state
      if (container.select('canvas').empty() && container.select('svg')) {
        initializeCanvasSVGLayers(container);
        setGlobals(scatterData);
      }

      // create the external object to handle rendering, if it doesn't exist
      if (!extScatterObj) {
        switch (rendering) {
          case "splatterplot": 
            extScatterObj = new splatterplot(selection, isDirty);
            break;
          default: 
            extScatterObj = new scatterplot_webgl(selection, isDirty);
        }
      }
        
      // explicitly update data and call a render on the WebGL helper
      updateWebGLdata(scatterData);
      selection.call(extScatterObj.circleSize(ptSize).setColorScale(colorScale), isDirty);

      // update the SVG overlay
      updateSVGOverlay(container, true);
    });
  }

  function updateWebGLdata(thisData) {
    if (extScatterObj)
      extScatterObj.setData(thisData, xValue, yValue, grpValue, foundGroups, scale);
    else
      console.warn("tried to update webgl data before initializing canvas");
  }

  // check if all data is OK; abort render if this check fails
  // NOTE: iterating over all data (e.g., 50k items) takes <20ms, so perf is okay
  function checkDataOkay() {
    if (!areFieldsSet) {
      console.warn("No fields set to read data from (try calling `fields`?)");
      return false;
    }
    
    // is x continuous? 
    if (scatterData.some(function(d) { return isNaN(xValue(d)); })) {
      console.warn("Given x-value function does not return a continuous number for all fields. First value is '%s'", xValue(scatterData[0]));
      return false;
    } 
    
    // is y continuous?
    if (scatterData.some(function(d) { return isNaN(yValue(d)); })) {
      console.warn("Given y-value function does not return a continuous number for all fields. First value is '%s'", yValue(scatterData[0]));
      return false;
    } 
    
    // does grpValue select a valid field?
    if (grpValue != null && grpValue(scatterData[0]) === undefined) {
      console.warn("Given group function does not select a valid field");
      return false;
    } 

    return true;
  }

  // contains the mapping of the rendering type to drawing type (svg, canvas, or webgl)
  function renderType() {
    switch (rendering) {
      case 'svg':
      case 'bins':
      case 'points':
      case 'custom-svg':
        return 'svg';
      case 'canvas':
        return 'canvas';
      case 'webgl':
      case 'splatterplot':
        return 'webgl';
      default:
        throw "Unknown rendertype (consider adding to renderType()): " + rendering;
    }
  }

  function render(selection) {
    if (!checkDataOkay()) {
      console.error("Unable to read data, aborting render for scatterplot '%s'.  There may be more information preceding this message", selectionName);
      return;
    }

    // were we requested to instantiate a particular vis type?
    switch (rendering) {
      case 'points':
        visType = points;
        break;
      case 'bins':
        visType = bins;
        break;
      default:
        visType = points; 
    }

    switch (renderType()) {
      case 'svg':
        redrawSVG(selection);
        break;
      case 'canvas':
        redrawCanvas(selection);
        break;
      case 'webgl': 
        redrawWebGL(selection);
        break;
      default: 
        throw "Unknown renderType passed to scatterplot: got " + renderType();
    }

    // reset dirty flags
    selectorChanged = false;
    isDirty = false;
  }
  
  /**
   * Kicks off a render of the scatterplot object on the given selection. Following D3.js convention,
   * this should be executed on a selection, 
   * e.g., d3.select('g.scatterplot').call(scatterObj, '.scatterplot'). 
   * The name argument is required to ensure that highlight dispatches from the factory are routed
   * to the correct scatterplots.
   * @param {d3.Selection} selection - The selection in which to instantiate and redraw the scatterplot.
   * @param {string} name - The name of this selection to namespace factory dispatch methods (this should be unique across all instantiated d3-twoDim components) 
   */
  function scatterplot(selection, name) {
    selectionName = name;
    render(selection);
    
    dispatch.on('highlight.' + name, function(selector) {
      switch (renderType()) {
        case 'svg': 
          extScatterObj.highlight(selection, selector);
          
          if (typeof selector === "function") {
            // generate relevant voronoi
            if (doVoronoi) {
              selection.call(
                generateVoronoi, 
                hiddenSupress ? scatterData.filter(selector) : scatterData);
            }
          } else if (!selector) { // no points are requested to be highlighted
            // clear the brush, if one exists
            if (doBrush) {
              // d3 v4 way:
              // selection.select("g.chartArea").call(brush.move, null);
              selection.select("g.chartArea").call(brush.clear());
            }
            
            if (doVoronoi) {
              if (doLimitMouse)
                selection.selectAll('g.voronoi').selectAll('path').remove();
              else
                selection.call(generateVoronoi, scatterData);
            }
          }
          break;
        default:
          throw "highlight not implemented for " + rendering;
      }
    });
  }
  
  /**
   * Gets or sets the data bound to points in the scatterplot.  Following D3.js convention, this should be
   * an array of anonymous objects.  Generally set all at once by the twoDFactory.setData() method
   * @default Empty array: []
   * @param {Object[]} The data of the scatterplot.  Set the `.x()` and `.y()` accessors for the x- and y-dimensions of the scatterplot
   * @param {function(Object[]): string} The key function for the data (similar to the key function in `d3.data([data, [key]])`)
   */
  scatterplot.data = function(newData, key) {
    if (!arguments.length) return scatterData;
    scatterData = newData;

    // TODO: test if there are <2 fields available, 
    // very likely that the code following will fail in those cases

    // if datums are objects, collect the available field names
    if (!Array.isArray(newData[0])) {
      for (var field in newData[0]) {
        if (newData[0].hasOwnProperty(field)) {
          availableFields.push(field);
        }
      }
      
      // if no field has been selected to view, select the first two fields
      if (!areFieldsSet) {
        scatterplot.fields(availableFields.slice(0, 2));
      }
    }
    
    // add original index value (this could be randomized)
    scatterData.forEach(function(d, i) {
      d['orig_index'] = i;
    });
    
    if (key)
      scatterDataKey = key;
    
    return scatterplot;
  };
  
  /**
   * Gets or sets the type of rendering mechanism.  One of "svg", "canvas", or "webgl".  Subsequent calls
   * of `scatterplot` on a selection will populate the selections with the given rendering type
   */
  scatterplot.renderType = function(renderType) {
    if (!arguments.length) return rendering;
    // if (['svg', 'canvas', 'webgl'].indexOf(renderType) == -1)
    //   throw "Expected value of 'svg', 'canvas', or 'webgl' to scatterplot.renderType";
    rendering = renderType;
    return scatterplot;
  }
  
  /**
   * The width of the constructed scatterplot.  The caller is responsible for maintaining sensible margins.
   * @default 1 (pixel)
   * @param {number} [val] - Sets the width of the scatterplot to the given value (in pixels).
   */ 
  scatterplot.width = function(val) {
    if (!arguments.length) return width;
    width = val;
    return scatterplot;
  };
  
  /**
   * The height of the constructed scatterplot.  The caller is responsible for maintaining sensible margins.
   * @default 1 (pixel)
   * @param {number} [val] - Sets the height of the scatterplot to the given value (in pixels).
   */
  scatterplot.height = function(val) {
    if (!arguments.length) return height;
    height = val;
    return scatterplot;
  }
  
  /**
   * The function to select the x-value from the datapoint
   * @default Function selects the first value in the datum (e.g. d[0])
   * @param {function(): number} [xVal] - The function that returns the x-axis value for a given point
   */
  scatterplot.x = function(xVal) {
    if (!arguments.length) return xValue;
    xValue = xVal;
    isDirty = true;
    selectorChanged = true;
    return scatterplot;
  }
  
  /**
   * The function to select the y-value from the datapoint
   * @default Function select the second value in the datum (e.g. d[1])
   * @param {function(): number} [yVal] - The function that returns the y-axis value for a given point
   */
  scatterplot.y = function(yVal) {
    if (!arguments.length) return yValue;
    yValue = yVal;
    isDirty = true;
    selectorChanged = true;
    return scatterplot;
  }
  
  /**
   * Sets the x-axis label for the scatterplot.
   * @default Blank value; no axis label is drawn.
   * @param {string} [xName] - The text that describes the x-axis
   */
  scatterplot.xLabel = function(xName) {
    if (!arguments.length) return name[0];
    name[0] = xName;
    return scatterplot;
  }
  
  /**
   * Sets the y-axis label for the scatterplot
   * @default Blank value; no axis label is drawn
   * @param {string} [yName] - The text that describes the y-axis
   */
  scatterplot.yLabel = function(yName) {
    if (!arguments.length) return name[1];
    name[1] = yName; 
    return scatterplot;
  }
  
  /**
   * Sets the x- and y-axis labels for the scatterplot at the same time, given an array of two strings.
   * @default Blank value; no axis label is drawn for both axes
   * @param {string[]} [names] - Array of labels to describe the x- and y-axis, respectively 
   */
  scatterplot.labels = function(names) {
    if (!arguments.length) return name; 
    if (names.length != 2) throw "Expected an array of length two for scatterplot.labels: [xLabel, yLabel]"
    name = names;
    return scatterplot;
  }
  
  /**
   * Convenience method to set the field for the x-dimension (given the row is an object and not an array),
   * and co-occurrently sets the xLabel
   * @default Function that selects the value for the x-dimension (e.g. d[0])
   * @param {string} [xField] - The field from which to read the continuous value for the x-dimension
   */
  scatterplot.xField = function(xField) {
    if (!arguments.length) return name[0];
    name[0] = xField;
    xValue = function(d) { return +d[xField]; };
    areFieldsSet = true;
    isDirty = true;
    selectorChanged = true;

    return scatterplot; 
  }
  
  /**
   * Convenience method to set the field for the y-dimension (given the row is an object and not an array),
   * and co-occurrently sets the yLabel
   * @default Function that selects the value for the y-dimension (e.g. d[0])
   * @param {string} [yField] - The field from which to read the continuous value for the y-dimension
   */
  scatterplot.yField = function(yField) {
    if (!arguments.length) return name[1];
    name[1] = yField;
    yValue = function(d) { return +d[yField]; };
    areFieldsSet = true;
    isDirty = true;
    selectorChanged = true;

    return scatterplot;
  }
  
  /**
   * Convenience method to set fields for both dimensions (given that rows are objects and not arrays), 
   * and co-occurrently sets the labels for the two dimensions
   * @default Blank values for axis labels
   * @param {string[]} [fields] - Array of fields for the x- and y-axis, respectively
   */
  scatterplot.fields = function(fields) {
    if (!arguments.length) return name;
    if (fields.length != 2) 
      throw "Expected an array of length two for scatterplot.fields: [xField, yField]";
    
    name = fields;
    xValue = function(d) { return +d[name[0]]; };
    yValue = function(d) { return +d[name[1]]; };
    areFieldsSet = true;
    isDirty = true;
    selectorChanged = true;
    
    return scatterplot;
  }
  
  /**
   * The size of the scatterplot marks
   * @default 3 (pixels)
   * @param {number} [newSize] - The new scatterplot mark size
   */
  scatterplot.circleSize = function(newSize) {
    if (!arguments.length) return ptSize;
    ptSize = newSize;
    if (extScatterObj) extScatterObj.circleSize(ptSize);
    return scatterplot; 
  }
  
  /**
   * Gets or sets the duration of animated transitions (in milliseconds) when updating the scatterplot 
   * bounds, axes, or point locations
   * @default Transitions have a duration of 500ms
   * @param {number} [newDuration] - The new duration of all animated transitions.
   */
  scatterplot.changeDuration = function(newDuration) {
    if (!arguments.length) return duration;
    duration = newDuration;
    return scatterplot;
  }
  
  /**
   * Pass in a custom function to uniquely identify a point (so it can be updated)
   * @default Uses the index of the point in the list of points (d3's default for key-less data)
   * @param {function()} [newIDFunc] - A function that returns a unique indentifier for a given point 
   */
  scatterplot.pointIdentifier = function(newIDFunc) {
    if (!arguments.length) return ptIdentifier;
    ptIdentifier = newIDFunc;
    return scatterplot;
  }
  
  /**
   * The function to select the grouping value from the datapoint
   * @default No function, meaning that all points are considered to be from the same series
   * @param {function(Object): string} [grpVal] - The function that returns the group identifier for a given point
   */
  scatterplot.groupColumn = function(grpVal) {
    if (!arguments.length) return grpVal;
    grpValue = grpVal;
    isDirty = true;
    selectorChanged = true;
    return scatterplot;
  }
  
  /**
   * The d3.ordinal color scale to map to the grouping column. The domain of the colorscale will 
   * be set at draw time from the current data.
   * @default Uses the `d3.scale.category10() color scale.
   * @param {d3.scale.ordinal(): string} [newScale] - The new `d3.scale.ordinal()` scale to use.
   */
  scatterplot.colorScale = function(newScale) {
    if (!arguments.length) return colorScale;
    colorScale = newScale;
    if (extScatterObj) extScatterObj.setColorScale(colorScale);
    return scatterplot;
  }
  
  /**
   * Gets or sets the bounds of the scatterplot.  The bounds are given as a 2D array, of the format
   * `[[xmin, xmax], [ymin, ymax]]`.  The scatterplot needs to then be called on the selection in
   * order to prompt a render to show the updated bounds.
   * @param {number[]} [newBounds] - Sets the bounds of the scatterplot to the supplied values   
   */
  scatterplot.bounds = function(newBounds) {
    if (!arguments.length) return [scale.x.domain(), scale.y.domain()];
    if (!Array.isArray(newBounds) || newBounds.length != 2) 
      throw "Expected array of length 2 to setBounds()";

    bounds = newBounds;
    isDirty = true;
    return scatterplot;
  }
  
  /**
   * Tells the scatterplot to support a D3 brush component.  
   * Points not selected by the brush will have the `hiddenClass` (default: 'point-hidden') CSS class
   * selector added.
   * @default false (no brush will be added to the scatterplot)
   * @todo Currently unable to enable both zoom and brush concurrently (mouse overloading)
   * @param {boolean} [newBrush] Whether or not to add a brush to the scatterplot.
   */
  scatterplot.doBrush = function(newBrush) {
    if (!arguments.length) return doBrush;
    doBrush = newBrush;
    return scatterplot;
  }
  
  /**
   * Tells the scatterplot to generate a voronoi overlay to make point-based mouse 
   * events easier for the viewer. By default, a voronoi overlay will be created for all 
   * points; pass `true` to `squashMouseEvents()` to disable the overlay when no points are 
   * highlighted for performance reasons. 
   * @default false (no voronoi will be generated when points are highlighted)
   * @param {boolean} [newVoronoi] - Whether or not to update a voronoi diagram based on highlighted points
   */
  scatterplot.doVoronoi = function(newVoronoi) {
    if (!arguments.length) return doVoronoi;
    doVoronoi = newVoronoi;
    return scatterplot;
  }

  /**
   * Tells the scatterplot to support zooming and panning the scatterplot
   * @default false (viewer will be unable to zoom and pan the scatterplot)
   * @todo Currently unable to enable both zoom and brush concurrently (mouse overloading)
   * @param {boolean} [newZoom] - Whether or not to enable zooming and panning in the scatterplot
   */
  scatterplot.doZoom = function(newZoom) {
    if (!arguments.length) return doZoom;
    doZoom = newZoom;
    return scatterplot;
  }

  /**
   * Tells the scatterplot to whether or not to supress mouse interaction when no points are 
   * highlighted. With the default value of `false`, all point-based mouse events will be fired.
   * When set to true, this disables voronoi generation and firing mouse events when no points are
   * highlighted, which can result in great redraw performance savings.
   * @default false (mouse events will be fired, regardless whether or not points are highlighted)
   * @param {boolean} [newSquash] - Whether mouse events should be supressed when no points are highlighted 
   */
  scatterplot.squashMouseEvents = function(newSquash) {
    if (!arguments.length) return doLimitMouse;
    doLimitMouse = !!newSquash;
    return scatterplot;
  }


  /**
   * Tells the scatterplot whether or not to supress mouse events for hidden (non-highlighted)
   * points. By default, this is `true`, meaning that mouse events will not be fired for those
   * points and associated voronois if those points are hidden by a highlight event. By changing
   * this value to `false`, all points can be targeted by mouse events, regardless of the point 
   * state.
   * @default true (mouse events will only be fired for highlighted points)
   * @param {boolean} [newSupress] - Whether mouse events should be supressed for hidden points
   */
  scatterplot.supressHiddenPoints = function(newSurpress) {
    if (!arguments.length) return hiddenSupress;
    hiddenSupress = newSurpress;
    return scatterplot;
  }

  /**
   * Changes the CSS class that is set when points are hidden. This can help avoid CSS namespace
   * collisions if the default class `point-hidden` is taken by an external CSS dependency.
   * @default `"point-hidden"` (you should style this CSS class to dim non-highlighted points)
   * @param {string} [newClass] - All hidden points will have this CSS class applied
   */
  scatterplot.hiddenClass = function(newClass) {
    if (!arguments.length) return hiddenClass;
    hiddenClass = newClass;
    return scatterplot;
  }

  /**
   * Tells the scatterplot to update the bounds of the representation whenever data accessors 
   * change.  If set to false, the user must manually update bounds by calling `bounds()`.
   * @default `autoUpdateBounds` is `true`; the scatterplot updates the bounds when accessors are
   * changed.
   * @param {boolean} [updateBounds] - Sets whether the scatterplot should update bounds when 
   * accessors are changed 
   */
  scatterplot.autoUpdateBounds = function(updateBounds) {
    if (!arguments.length) return autoBounds;
    autoBounds = updateBounds;
    return scatterplot;
  }

  scatterplot.showDistribution = function(newDistType) {
    if (!arguments.length) return distType;
    distType = newDistType;
    return scatterplot;
  }
  
  return d3.rebind(scatterplot, localDispatch, 'on');
};
