import { FALLBACK_CS, FALLBACK_PROJECTION } from '../utils/Constants';

export var MapMLFeatures = L.FeatureGroup.extend({
  /*
   * M.MapML turns any MapML feature data into a Leaflet layer. Based on L.GeoJSON.
   */
    initialize: function (mapml, options) {
    
      L.setOptions(this, options);
      this._container = L.DomUtil.create('div','leaflet-layer', this.options.pane);
      // must have leaflet-pane class because of new/changed rule in leaflet.css
      // info: https://github.com/Leaflet/Leaflet/pull/4597 
      L.DomUtil.addClass(this._container,'leaflet-pane mapml-vector-container');
      L.setOptions(this.options.renderer, {pane: this._container});
      this._layers = {};
      if(this.options.query){
        this._mapmlFeatures = mapml;
        this.isVisible = true;
        let native = this._getNativeVariables(mapml);
        this.options.nativeZoom = native.zoom;
        this.options.nativeCS = native.cs;
      }
      if (mapml && !this.options.query) {
        let native = this._getNativeVariables(mapml);
        //needed to check if the feature is static or not, since this method is used by templated also
        if(!mapml.querySelector('extent') && mapml.querySelector('feature')){
          this._features = {};
          this._staticFeature = true;
          this.isVisible = true; //placeholder for when this actually gets updated in the future
          this.zoomBounds = this._getZoomBounds(mapml, native.zoom);
          this.layerBounds = this._getLayerBounds(mapml);
          L.extend(this.options, this.zoomBounds);
        }
        this.addData(mapml, native.cs, native.zoom);
        if(this._staticFeature){
          this._resetFeatures(this._clampZoom(this.options._leafletLayer._map.getZoom()));

          this.options._leafletLayer._map._addZoomLimit(this);
        }
      }
    },

    onAdd: function(map){
      L.FeatureGroup.prototype.onAdd.call(this, map);
      if(this._mapmlFeatures)map.on("featurepagination", this.showPaginationFeature, this);
      map.on('popupopen', this.attachParts, this);
      this._updateTabIndex();
    },

    onRemove: function(map){
      L.FeatureGroup.prototype.onRemove.call(this, map);
      if(this._mapmlFeatures){
        map.off("featurepagination", this.showPaginationFeature, this);
        delete this._mapmlFeatures;
      }
      map.off('popupopen', this.attachParts);
      L.DomUtil.remove(this._container);
    },

    getEvents: function(){
      if(this._staticFeature){
        return {
          'moveend':this._handleMoveEnd,
        };
      }
      return {
        'moveend':this._removeCSS
      };
    },

    _updateTabIndex: function(){
      for(let feature in this._features){
        for(let path of this._features[feature]){
          if(path._path){
            if(path._path.getAttribute("d") !== "M0 0"){
              path._path.setAttribute("tabindex", 0);
            } else {
              path._path.removeAttribute("tabindex");
            }
            if(path._path.childElementCount === 0) {
              let title = document.createElement("title");
              title.innerText = "Feature";
              path._path.appendChild(title);
            }
          }
        }
      }
    },

    showPaginationFeature: function(e){
      if(this.options.query && this._mapmlFeatures.querySelectorAll("feature")[e.i]){
        let feature = this._mapmlFeatures.querySelectorAll("feature")[e.i];
        this.clearLayers();
        this.addData(feature, this.options.nativeCS, this.options.nativeZoom);
        e.popup._navigationBar.querySelector("p").innerText = (e.i + 1) + "/" + this.options._leafletLayer._totalFeatureCount;
        e.popup._content.querySelector("iframe").srcdoc = `<meta http-equiv="content-security-policy" content="script-src 'none';">` + feature.querySelector("properties").innerHTML;
      }
    },

    _previousFeature: function(e){      
      if(this._source.subParts.length > 0){
        this._source.subParts[this._count]._path.focus();
        this._count = this._count === 0 ? 0 : this._count - 1;
      } else if(this._source._path.previousSibling){
        this._source._path.previousSibling.focus();
        this._map.closePopup();
      } else {
        this._source._path.focus();
        this._map.closePopup();
      }
    },

    _nextFeature: function(e){
      if(this._source.subParts.length > 0){
        this._source.subParts[this._count]._path.focus();
        this._count = this._count === this._source.subParts.length - 1 ? this._source.subParts.length - 1 : this._count + 1;
      } else if (this._source._path.nextSibling){
        this._source._path.nextSibling.focus();
        this._map.closePopup();
      } else {
        this._source._path.focus();
        this._map.closePopup();
      }
    },

    _getNativeVariables: function(mapml){
      let nativeZoom = mapml.querySelector("meta[name=zoom]") && 
          +M.metaContentToObject(mapml.querySelector("meta[name=zoom]").getAttribute("content")).value || 0;
      let nativeCS = mapml.querySelector("meta[name=cs]") && 
          M.metaContentToObject(mapml.querySelector("meta[name=cs]").getAttribute("content")).content || "GCRS";
      return {zoom:nativeZoom, cs: nativeCS};
    },

    _handleMoveEnd : function(){
      let mapZoom = this._map.getZoom();
      if(mapZoom > this.zoomBounds.maxZoom || mapZoom < this.zoomBounds.minZoom){
        this.clearLayers();
        this.isVisible = false;
        return;
      }
      let clampZoom = this._clampZoom(mapZoom);
      this._resetFeatures(clampZoom);
      this.isVisible = this._layers && this.layerBounds && 
                        this.layerBounds.overlaps(
                          M.pixelToPCRSBounds(
                            this._map.getPixelBounds(),
                            mapZoom,this._map.options.projection));
      this._removeCSS();
      this._updateTabIndex();
    },

    //sets default if any are missing, better to only replace ones that are missing
    _getLayerBounds : function(container) {
      if (!container) return null;
      let cs = FALLBACK_CS,
          projection = container.querySelector('meta[name=projection]') &&
                    M.metaContentToObject(
                      container.querySelector('meta[name=projection]').getAttribute('content'))
                      .content.toUpperCase() || FALLBACK_PROJECTION;
      try{

        let meta = container.querySelector('meta[name=extent]') && 
                    M.metaContentToObject(
                      container.querySelector('meta[name=extent]').getAttribute('content'));

        let zoom = meta.zoom || 0;
        
        let metaKeys = Object.keys(meta);
        for(let i =0;i<metaKeys.length;i++){
          if(!metaKeys[i].includes("zoom")){
            cs = M.axisToCS(metaKeys[i].split("-")[2]);
            break;
          }
        }
        let axes = M.csToAxes(cs);
        return M.boundsToPCRSBounds(
                L.bounds(L.point(+meta[`top-left-${axes[0]}`],+meta[`top-left-${axes[1]}`]),
                L.point(+meta[`bottom-right-${axes[0]}`],+meta[`bottom-right-${axes[1]}`])),
                zoom,projection,cs);
      } catch (error){
        //if error then by default set the layer to osm and bounds to the entire map view
        return M.boundsToPCRSBounds(M[projection].options.crs.tilematrix.bounds(0),0,projection, cs);
      }
    },

    _resetFeatures : function (zoom){
      this.clearLayers();
      if(this._features && this._features[zoom]){
        for(let k =0;k < this._features[zoom].length;k++){
          this.addLayer(this._features[zoom][k]);
        }
      }
    },

    _clampZoom : function(zoom){
      if(zoom > this.zoomBounds.maxZoom || zoom < this.zoomBounds.minZoom) return zoom;
      if (undefined !== this.zoomBounds.minNativeZoom && zoom < this.zoomBounds.minNativeZoom) {
        return this.zoomBounds.minNativeZoom;
      }
      if (undefined !== this.zoomBounds.maxNativeZoom && this.zoomBounds.maxNativeZoom < zoom) {
        return this.zoomBounds.maxNativeZoom;
      }

      return zoom;
    },

    _setZoomTransform: function(center, clampZoom){
      var scale = this._map.getZoomScale(this._map.getZoom(),clampZoom),
		    translate = center.multiplyBy(scale)
		        .subtract(this._map._getNewPixelOrigin(center, this._map.getZoom())).round();

      if (any3d) {
        L.setTransform(this._layers[clampZoom], translate, scale);
      } else {
        L.setPosition(this._layers[clampZoom], translate);
      }
    },

    _getZoomBounds: function(container, nativeZoom){
      if (!container) return null;
      let nMin = 100,nMax=0, features = container.getElementsByTagName('feature'),meta,projection;
      for(let i =0;i<features.length;i++){
        let lZoom = +features[i].getAttribute('zoom');
        if(!features[i].getAttribute('zoom'))lZoom = nativeZoom;
        nMax = Math.max(nMax, lZoom);
        nMin = Math.min(nMin, lZoom);
      }
      try{
        projection = M.metaContentToObject(container.querySelector('meta[name=projection]').getAttribute('content')).content;
        meta = M.metaContentToObject(container.querySelector('meta[name=zoom]').getAttribute('content'));
      } catch(error){
        return {
          minZoom:0,
          maxZoom: M[projection || FALLBACK_PROJECTION].options.resolutions.length - 1,
          minNativeZoom:nMin,
          maxNativeZoom:nMax
        };
      }
      return {
        minZoom:+meta.min ,
        maxZoom:+meta.max ,
        minNativeZoom:nMin,
        maxNativeZoom:nMax
      };
    },

    addData: function (mapml, nativeCS, nativeZoom) {
      var features = mapml.nodeType === Node.DOCUMENT_NODE || mapml.nodeName === "LAYER-" ? mapml.getElementsByTagName("feature") : null,
          i, len, feature;

      var linkedStylesheets = mapml.nodeType === Node.DOCUMENT_NODE ? mapml.querySelector("link[rel=stylesheet],style") : null;
      if (linkedStylesheets) {
        var base = mapml.querySelector('base') && mapml.querySelector('base').hasAttribute('href') ? 
            new URL(mapml.querySelector('base').getAttribute('href')).href : 
            mapml.URL;
        M.parseStylesheetAsHTML(mapml,base,this._container);
      }
      if (features) {
       for (i = 0, len = features.length; i < len; i++) {
        // Only add this if geometry is set and not null
        feature = features[i];
        var geometriesExist = feature.getElementsByTagName("geometry").length && feature.getElementsByTagName("coordinates").length;
        if (geometriesExist) {
         this.addData(feature, nativeCS, nativeZoom);
        }
       }
       return this; //if templated this runs
      }

      //if its a mapml with no more links this runs
      var options = this.options;

      if (options.filter && !options.filter(mapml)) { return; }
      
      if (mapml.classList.length) {
        options.className = mapml.classList.value;
      }
      let zoom = mapml.getAttribute("zoom") || nativeZoom;

      var layer = this.geometryToLayer(mapml, options.pointToLayer, options.coordsToLatLng, options, nativeCS, +zoom);
      if (layer) {
        layer.properties = mapml.getElementsByTagName('properties')[0];
        
        // if the layer is being used as a query handler output, it will have
        // a color option set.  Otherwise, copy classes from the feature
        if (!layer.options.color && mapml.hasAttribute('class')) {
          layer.options.className = mapml.getAttribute('class');
        }
        layer.defaultOptions = layer.options;
        this.resetStyle(layer);

        if (options.onEachFeature) {
         options.onEachFeature(layer.properties, layer);
         if(layer._events){
            layer._events.keypress.push({
              "ctx": layer,
              "fn": this._onSpacePress,
            });
          }
        }
        if(this._staticFeature){
          let featureZoom = mapml.getAttribute('zoom') || nativeZoom;
          if(featureZoom in this._features){
            this._features[featureZoom].push(layer);
          } else{
            this._features[featureZoom]=[layer];
          }
          return;
        } else {
          return this.addLayer(layer);
        }
      }
    },
        
    resetStyle: function (layer) {
      var style = this.options.style;
      if (style) {
       // reset any custom styles
       L.Util.extend(layer.options, layer.defaultOptions);
       this._setLayerStyle(layer, style);
      }
    },

    setStyle: function (style) {
      this.eachLayer(function (layer) {
        this._setLayerStyle(layer, style);
      }, this);
    },

    _setLayerStyle: function (layer, style) {
      if (typeof style === 'function') {
        style = style(layer.feature);
      }
      if (layer.setStyle) {
        layer.setStyle(style);
      }
    },
    _removeCSS: function(){
      let toDelete = this._container.querySelectorAll("link[rel=stylesheet],style");
      for(let i = 0; i < toDelete.length;i++){
        this._container.removeChild(toDelete[i]);
      }
    },
    _onSpacePress: function(e){
      if(e.originalEvent.keyCode === 32){
        this._openPopup(e);
      }
    },
	 geometryToLayer: function (mapml, pointToLayer, coordsToLatLng, vectorOptions, nativeCS, zoom) {
    var geometry = mapml.tagName.toUpperCase() === 'FEATURE' ? mapml.getElementsByTagName('geometry')[0] : mapml,
        latlng, latlngs, coordinates, member, members, linestrings, ctx = this, parts;

    coordsToLatLng = coordsToLatLng || this.coordsToLatLng;
    var pointOptions = {  opacity: vectorOptions.opacity ? vectorOptions.opacity : null,
                          icon: L.icon(
                            { iconUrl: vectorOptions.imagePath+"marker-icon.png",
                              iconRetinaUrl: vectorOptions.imagePath+"marker-icon-2x.png",
                              shadowUrl: vectorOptions.imagePath+"marker-shadow.png",
                              iconSize: [25, 41],
                              iconAnchor: [12, 41],
                              popupAnchor: [1, -34],
                              shadowSize: [41, 41]
                            })};
    
    var cs = geometry.getAttribute("cs") || nativeCS;

    switch (geometry.firstElementChild.tagName.toUpperCase()) {
      case 'POINT':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.split(/\s+/gim).forEach(M.parseNumber,coordinates);
        latlng = coordsToLatLng(coordinates, cs, zoom, this.options.projection);
        return pointToLayer ? pointToLayer(mapml, latlng) : 
                                    new L.Marker(latlng, pointOptions);

      case 'MULTIPOINT':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.match(/(\S+ \S+)/gim).forEach(M.splitCoordinate, coordinates);
        latlngs = this.coordsToLatLngs(coordinates, 0, coordsToLatLng, cs, zoom);
        var points = new Array(latlngs.length);
        for(member=0;member<points.length;member++) {
          points[member] = new L.Marker(latlngs[member],pointOptions);
        }
        return new L.featureGroup(points);
      case 'LINESTRING':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.match(/(\S+ \S+)/gim).forEach(M.splitCoordinate, coordinates);
        latlngs = this.coordsToLatLngs(coordinates, 0, coordsToLatLng, cs, zoom);
        return new L.Polyline(latlngs, vectorOptions);
      case 'MULTILINESTRING':
        members = geometry.getElementsByTagName('coordinates');
        linestrings = new Array(members.length);
        for (member=0;member<members.length;member++) {
          linestrings[member] = coordinatesToArray(members[member]);
        }
        latlngs = this.coordsToLatLngs(linestrings, 2, coordsToLatLng, cs, zoom);
        return new L.Polyline(latlngs, vectorOptions);
      case 'POLYGON':
        var rings = geometry.getElementsByTagName('coordinates');
        latlngs = this.coordsToLatLngs(coordinatesToArray(rings), 1, coordsToLatLng, cs, zoom);
        let polygon = new L.Polygon(latlngs, vectorOptions);
        polygon.subParts = parts;
        return polygon;
      case 'MULTIPOLYGON':
        members = geometry.getElementsByTagName('polygon');
        var polygons = new Array(members.length);
        for (member=0;member<members.length;member++) {
          polygons[member] = coordinatesToArray(members[member].querySelectorAll('coordinates'));
        }
        latlngs = this.coordsToLatLngs(polygons, 2, coordsToLatLng, cs, zoom);
        return new L.Polygon(latlngs, vectorOptions);
      case 'GEOMETRYCOLLECTION':
        console.log('GEOMETRYCOLLECTION Not implemented yet');
        break;
    //			for (i = 0, len = geometry.geometries.length; i < len; i++) {
    //
    //				layers.push(this.geometryToLayer({
    //					geometry: geometry.geometries[i],
    //					type: 'Feature',
    //					properties: geojson.properties
    //				}, pointToLayer, coordsToLatLng, vectorOptions));
    //			}
    //			return new L.FeatureGroup(layers);

      default:
        console.log(parts); //temporary
        console.log('Invalid GeoJSON object.');
        break;
    }

    function coordinatesToArray(coordinates, first = true) {
      var a = new Array(coordinates.length),
          localParts = [];
      for (var i=0;i<a.length;i++) {
        a[i]=[];
        let coords = (coordinates[i] || coordinates),
            spans = coords.children;
        for(let span of spans){
          let subParts = coordinatesToArray(span, false),
              spanLayer = new L.Polygon(ctx.coordsToLatLngs(subParts[0], 1, coordsToLatLng, cs, zoom), {...vectorOptions, color:'yellow',});
              
          spanLayer.subParts = subParts[1];
          localParts.push(spanLayer);
        }
        coords.textContent = coords.textContent.replace( /(<([^>]+)>)/ig, '');
        coords.textContent.match(/(\S+\s+\S+)/gim).forEach(M.splitCoordinate, a[i]);
      }
      if (first){ 
        parts = localParts;
        return a;
      } else {
        return [a, localParts];
      }
    }
  },

  attachParts: function (e){
    if(this._map){
      for(let part of e.popup._source.subParts){
        this.addLayer(part);
        e.popup._source._path.after(part._path);
        part._path.setAttribute('tabindex', 0);
      }
    }
  },

  coordsToLatLng: function (coords, cs, zoom, projection) { // (Array[, Boolean]) -> LatLng
    let pcrs;
    switch(cs.toUpperCase()){
      case "PCRS":
        pcrs = coords;
        break;
      case "TILEMATRIX":
        let pixels = coords.map((value)=>{
          return value * M[projection].options.crs.tile.bounds.max.x;
        });
        pcrs = M[projection].transformation.untransform(L.point(pixels),M[projection].scale(+zoom));
        break;
      case "TCRS":
        pcrs = M[projection].transformation.untransform(L.point(coords),M[projection].scale(+zoom));
        break;
      default:
        return new L.LatLng(coords[1], coords[0], coords[2]);
    }

    return M[projection].unproject(L.point(pcrs), +zoom);
  },

  coordsToLatLngs: function (coords, levelsDeep, coordsToLatLng, cs, zoom) { // (Array[, Number, Function]) -> Array
    var latlng, i, len,
        latlngs = [];

    for (i = 0, len = coords.length; i < len; i++) {
     latlng = levelsDeep ?
             this.coordsToLatLngs(coords[i], levelsDeep - 1, coordsToLatLng, cs, zoom) :
             (coordsToLatLng || this.coordsToLatLng)(coords[i], cs, zoom, this.options.projection);

     latlngs.push(latlng);
    }

    return latlngs;
  }
});
export var mapMlFeatures = function (mapml, options) {
	return new MapMLFeatures(mapml, options);
};