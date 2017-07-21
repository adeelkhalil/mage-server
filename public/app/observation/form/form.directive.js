angular
  .module('mage')
  .directive('formDirective', formDirective);

function formDirective() {
  var directive = {
    templateUrl: 'app/observation/form/form.directive.html',
    restrict: 'E',
    transclude: true,
    scope: {
      form: '=',
      observation: '=formObservation',
      preview: '=formPreview'
    },
    controller: FormDirectiveController
  };

  return directive;
}

FormDirectiveController.$inject = ['$scope', 'EventService', 'Observation', 'ObservationService', 'UserService', 'LocalStorageService'];

function FormDirectiveController($scope, EventService, Observation, ObservationService, UserService, LocalStorageService) {
  var uploadId = 0;
  var initialObservation;

  if ($scope.observation) {
    initialObservation = JSON.parse(JSON.stringify($scope.observation));
    $scope.iconUrl = $scope.observation.style.iconUrl;
    $scope.event = EventService.getEventById($scope.observation.eventId);
    var editedVertex = 0;
    var geometryField = $scope.form.geometryField;
    $scope.shape = geometryField.value.type;
    var copy = JSON.parse(JSON.stringify(geometryField.value));
    geometryField.value = copy;
    updateGeometryEdit(geometryField, editedVertex);
    $scope.$emit('observation:editStarted', $scope.observation);
    $scope.$on('observation:moved', function(e, observation, geometry) {
      if (!$scope.observation || !geometry) return;

      var geometryField = $scope.form.geometryField;
      var copy = JSON.parse(JSON.stringify(geometry));
      geometryField.value = copy;
      updateGeometryEdit(geometryField, editedVertex);
    });
    $scope.$on('observation:edit:vertex', function(e, observation, latlng, index) {
      editedVertex = index;
      var geometryField = $scope.form.geometryField;
      if (geometryField.value.type === 'LineString') {
        geometryField.value.coordinates[index] = [latlng.lng, latlng.lat];
      } else if (geometryField.value.type === 'Polygon') {
        geometryField.value.coordinates[0][index] = [latlng.lng, latlng.lat];
      }
      updateGeometryEdit(geometryField, editedVertex);
    });
    $scope.$watch('form', function() {
      var geometryField = $scope.form.geometryField;
      var copy = JSON.parse(JSON.stringify(geometryField));
      var obs = {id: $scope.observation.id, geometry: copy.value};
      if (copy.value.type === 'Polygon' && copy.value.coordinates[0].length > 0) {
        if (copy.value.coordinates[0][0][0] !== copy.value.coordinates[0][copy.value.coordinates[0].length-1][0]
        || copy.value.coordinates[0][0][1] !== copy.value.coordinates[0][copy.value.coordinates[0].length-1][1]) {
          return;
        }
      } else if (copy.value.type === 'LineString' && copy.value.coordinates.length > 0) {
        if (copy.value.coordinates[0][0] !== copy.value.coordinates[copy.value.coordinates.length-1][0]
        || copy.value.coordinates[0][1] !== copy.value.coordinates[copy.value.coordinates.length-1][1]) {
          return;
        }
      }
      updateGeometryEdit(geometryField, editedVertex);
      if (geometryField.value.type !== $scope.shape) {
        $scope.shape = geometryField.value.type;
        editedVertex = 0;
      }
      $scope.$emit('observation:shapeChanged', obs);

      var formId = null;
      var primary = null;
      var variant = null;
      if ($scope.form.forms.length > 0) {
        var firstForm = $scope.form.forms[0];
        formId = firstForm.id;
        primary = EventService.getFormField(firstForm, firstForm.primaryField) || {};
        variant = EventService.getFormField(firstForm, firstForm.variantField) || {};
      }

      var iconUrl = ObservationService.getObservationIconUrlForEvent($scope.event.id, formId, primary.value, variant.value);

      if (iconUrl !== $scope.iconUrl) {
        $scope.iconUrl = iconUrl;
        $scope.$emit('observation:iconEdited', obs, iconUrl);
      }
    }, true);
  }

  $scope.getToken = LocalStorageService.getToken;
  $scope.amAdmin = UserService.amAdmin;
  $scope.attachmentUploads = {};

  function updateGeometryEdit(geometryField, vertex) {
    if (!geometryField.value.coordinates) return;
    geometryField.editedVertex = vertex;
    if (geometryField.value.type === 'LineString') {
      geometryField.edit = geometryField.value.coordinates[vertex];
    } else if (geometryField.value.type === 'Polygon') {
      if (geometryField.value.coordinates[0]) {
        geometryField.edit = geometryField.value.coordinates[0][vertex];
      }
    }
  }

  function formToObservation(form, observation) {
    var geometry = form.geometryField.value;

    // put all coordinates in -180 to 180
    switch (geometry.type) {
    case 'Point':
      if (geometry.coordinates[0] < -180) geometry.coordinates[0] = geometry.coordinates[0] + 360;
      else if (geometry.coordinates[0] > 180) geometry.coordinates[0] = geometry.coordinates[0] - 360;
      break;
    case 'LineString':
      for (var i = 0; i < geometry.coordinates.length; i++) {
        var coord = geometry.coordinates[i];
        while (coord[0] < -180) coord[0] = coord[0] + 360;
        while (coord[0] > 180) coord[0] = coord[0] - 360;
      }
      break;
    case 'Polygon':
      for (var p = 0; p < geometry.coordinates.length; p++) {
        var poly = geometry.coordinates[p];
        for (var i = 0; i < poly.length; i++) {
          var coord = poly[i];
          while (coord[0] < -180) coord[0] = coord[0] + 360;
          while (coord[0] > 180) coord[0] = coord[0] - 360;
        }
      }
      break;
    }
    observation.geometry = geometry;

    observation.properties.forms = [];
    _.each(form.forms, function(observationForm) {
      var propertiesForm = {
        formId: observationForm.id
      };

      _.each(observationForm.fields, function(field) {
        propertiesForm[field.name] = field.value;
      });

      observation.properties.forms.push(propertiesForm);
    });
  }

  $scope.save = function() {
    $scope.saving = true;
    var markedForDelete = _.filter($scope.observation.attachments, function(a){ return a.markedForDelete; });
    formToObservation($scope.form, $scope.observation);
    // this is a hack that will be corrected when we pull ids from the server
    if ($scope.observation.id === 'new') {
      delete $scope.observation.id;
    }
    EventService.saveObservation($scope.observation).then(function() {
      if (_.some(_.values($scope.attachmentUploads), function(v) {return v;})) {
        $scope.uploadAttachments = true;
      } else {
        $scope.form = null;
        $scope.attachmentUploads = {};
      }

      // delete any attachments that were marked for delete
      _.each(markedForDelete, function(attachment) {
        EventService.deleteAttachmentForObservation($scope.observation, attachment);
      });

      if (!$scope.uploadAttachments) {
        $scope.$emit('observation:editDone', $scope.observation);
        $scope.saving = false;
      }
    });
  };

  $scope.cancelEdit = function() {
    $scope.observation.geometry = initialObservation.geometry;
    $scope.$emit('observation:editDone', $scope.observation);

    _.map($scope.observation.attachments, function(attachment) {
      delete attachment.markedForDelete;
      return attachment;
    });
  };

  $scope.deleteObservation = function() {
    EventService.archiveObservation($scope.observation).then(function() {
      $scope.$emit('observation:editDone',  $scope.observation);
    });
  };

  $scope.addAttachment = function() {
    uploadId++;
    $scope.attachmentUploads[uploadId] = false;
  };

  $scope.removeFileUpload = function(id) {
    delete $scope.attachmentUploads[id];
  };

  $scope.$on('observation:move', function(e, observation) {
    if (observation.id) {
      // Don't propagate above this directive if this is en edit
      // for an existing observation
      e.stopPropagation();
    }
  });

  $scope.$on('uploadFile', function(e, id) {
    $scope.attachmentUploads[id] = true;
  });

  $scope.$on('uploadComplete', function(e, url, response, id) {
    EventService.addAttachmentToObservation($scope.observation, response);

    delete $scope.attachmentUploads[id];
    if (_.keys($scope.attachmentUploads).length === 0) {
      $scope.attachmentUploads = {};

      $scope.$emit('observation:editDone', $scope.observation);
      $scope.saving = false;
      $scope.uploadAttachments = false;
    }
  });

  // TODO warn user in some way that attachment didn't upload
  $scope.$on('uploadFailed', function(e, url, response, id) {
    delete $scope.attachmentUploads[id];
    if (_.keys($scope.attachmentUploads).length === 0) {
      $scope.attachmentUploads = {};

      $scope.$emit('observation:editDone');
      $scope.saving = false;
    }
  });
}
