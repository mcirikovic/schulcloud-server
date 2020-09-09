const hooks = require('./hooks');
const EduSharingConnector = require('./logic/EduSharingConnector');

class EduSearch {
	find(data) {
		return EduSharingConnector.FIND(data);
	}

	get(id, params) {
		return EduSharingConnector.GET(id, params);
	}
}

module.exports = (app) => {
	const eduRoute = '/edu-sharing';
	app.use(eduRoute, new EduSearch(), (req, res) => {
		res.send(res.data);
	});
	const eduService = app.service(eduRoute);
	eduService.hooks(hooks);
};
