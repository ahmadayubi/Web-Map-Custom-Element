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
      if (mapml) {
        //needed to check if the feature is static or not, since this method is used by templated also
        if(!mapml.querySelector('extent') && mapml.querySelector('feature')){
          this._features = {};
          this._staticFeature = true;
          this.isVisible = true; //placeholder for when this actually gets updated in the future
          this.nativeZoom = +this._getNativeZoom(mapml);
          this.zoomBounds = this._getZoomBounds(mapml);
          this.layerBounds = this._getLayerBounds(mapml);
          L.extend(this.options, this.zoomBounds);
        }
        this.addData(mapml);
        if(this._staticFeature){
          this._resetFeatures(this._clampZoom(this.options._leafletLayer._map.getZoom()));

          this.options._leafletLayer._map._addZoomLimit(this);
        }
      }
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
    },

    //sets default if any are missing, better to only replace ones that are missing
    _getLayerBounds : function(container) {
      if (!container) return null;
      try{
        let projection = container.querySelector('meta[name=projection]') &&
                          M.metaContentToObject(
                            container.querySelector('meta[name=projection]').getAttribute('content'))
                            .content.toUpperCase() || FALLBACK_PROJECTION;
        let zoom = this._getNativeZoom(container);
        let meta = container.querySelector('meta[name=extent]') && 
                    M.metaContentToObject(
                      container.querySelector('meta[name=extent]').getAttribute('content')) ||
                    {"top-left-vertical":0,"top-left-horizontal":0,"bottom-right-vertical":5,"bottom-right-horizontal":5};
        let cs = meta.cs || FALLBACK_CS;
        return M.boundsToPCRSBounds(
                L.bounds(L.point(+meta["top-left-vertical"],+meta["top-left-horizontal"]),
                L.point(+meta["bottom-right-vertical"],+meta["bottom-right-horizontal"])),
                zoom,projection,cs);
      } catch (error){
        //if error then by default set the layer to osm and bounds to the entire map view
        return M.boundsToPCRSBounds(M[FALLBACK_PROJECTION].options.crs.tilematrix.bounds(0),0,FALLBACK_PROJECTION,FALLBACK_CS);
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

    _getNativeZoom: function(mapml){
      return mapml.querySelector('meta[name=zoom]') && 
        M.metaContentToObject(mapml.querySelector('meta[name=zoom]').getAttribute('content')).value || 
        "0";
    },

    _getZoomBounds: function(container){
      if (!container) return null;
      let nMin = 100,nMax=0, features = container.getElementsByTagName('feature'),meta,projection;
      for(let i =0;i<features.length;i++){
        if(!features[i].getAttribute('zoom')) continue;
        if(+features[i].getAttribute('zoom') > nMax) nMax = +features[i].getAttribute('zoom');
        if(+features[i].getAttribute('zoom') < nMin) nMin = +features[i].getAttribute('zoom');
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

    addData: function (mapml) {
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
         this.addData(feature);
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

      var layer = M.MapMLFeatures.geometryToLayer(mapml, options.pointToLayer, options.coordsToLatLng, options);
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
        }
        if(this._staticFeature){
          let featureZoom = mapml.getAttribute('zoom') || this.nativeZoom;
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
	 geometryToLayer: function (mapml, pointToLayer, coordsToLatLng, vectorOptions) {
    var geometry = mapml.tagName.toUpperCase() === 'FEATURE' ? mapml.getElementsByTagName('geometry')[0] : mapml,
        latlng, latlngs, coordinates, member, members, linestrings;

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

    switch (geometry.firstElementChild.tagName.toUpperCase()) {
      case 'POINT':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.split(/\s+/gim).forEach(M.parseNumber,coordinates);
        latlng = coordsToLatLng(coordinates);
        return pointToLayer ? pointToLayer(mapml, latlng) : 
                                    new L.Marker(latlng, pointOptions);

      case 'MULTIPOINT':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.match(/(\S+ \S+)/gim).forEach(M.splitCoordinate, coordinates);
        latlngs = this.coordsToLatLngs(coordinates, 0, coordsToLatLng);
        var points = new Array(latlngs.length);
        for(member=0;member<points.length;member++) {
          points[member] = new L.Marker(latlngs[member],pointOptions);
        }
        return new L.featureGroup(points);
      case 'LINESTRING':
        coordinates = [];
        geometry.getElementsByTagName('coordinates')[0].textContent.match(/(\S+ \S+)/gim).forEach(M.splitCoordinate, coordinates);
        latlngs = this.coordsToLatLngs(coordinates, 0, coordsToLatLng);
        return new L.Polyline(latlngs, vectorOptions);
      case 'MULTILINESTRING':
        members = geometry.getElementsByTagName('coordinates');
        linestrings = new Array(members.length);
        for (member=0;member<members.length;member++) {
          linestrings[member] = coordinatesToArray(members[member]);
        }
        latlngs = this.coordsToLatLngs(linestrings, 2, coordsToLatLng);
        return new L.Polyline(latlngs, vectorOptions);
      case 'POLYGON':
        var rings = geometry.getElementsByTagName('coordinates');
        latlngs = this.coordsToLatLngs(coordinatesToArray(rings), 1, coordsToLatLng);
        return new L.Polygon(latlngs, vectorOptions);
      case 'MULTIPOLYGON':
        members = geometry.getElementsByTagName('polygon');
        var polygons = new Array(members.length);
        for (member=0;member<members.length;member++) {
          polygons[member] = coordinatesToArray(members[member].querySelectorAll('coordinates'));
        }
        latlngs = this.coordsToLatLngs(polygons, 2, coordsToLatLng);
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
        console.log('Invalid GeoJSON object.');
        break;
    }
    function coordinatesToArray(coordinates) {
      var a = new Array(coordinates.length);
      for (var i=0;i<a.length;i++) {
        a[i]=[];
        (coordinates[i] || coordinates).textContent.match(/(\S+\s+\S+)/gim).forEach(M.splitCoordinate, a[i]);
      }
      return a;
    }
  },
        

  coordsToLatLng: function (coords) { // (Array[, Boolean]) -> LatLng
   return new L.LatLng(coords[1], coords[0], coords[2]);
  },

  coordsToLatLngs: function (coords, levelsDeep, coordsToLatLng) { // (Array[, Number, Function]) -> Array
    var latlng, i, len,
        latlngs = [];

    for (i = 0, len = coords.length; i < len; i++) {
     latlng = levelsDeep ?
             this.coordsToLatLngs(coords[i], levelsDeep - 1, coordsToLatLng) :
             (coordsToLatLng || this.coordsToLatLng)(coords[i]);

     latlngs.push(latlng);
    }

    return latlngs;
  }
});
export var mapMlFeatures = function (mapml, options) {
	return new M.MapMLFeatures(mapml, options);
};