const service = require('feathers-mongoose');
const problemModel = require('./model');
const hooks = require('./hooks');
const logger = require('../../logger');
const GLOBALS = require('../../../config/globals');

if (process.env.BODYPARSER_JSON_LIMIT === undefined) {
	/* eslint-disable-next-line  */
	logger.warning(`please set the environment variable BODYPARSER_JSON_LIMIT to 12mb for helpdesk to work correctly! (Currently: ${GLOBALS.BODYPARSER_JSON_LIMIT})`);
}

module.exports = function () {
	const app = this;

	const options = {
		Model: problemModel,
		paginate: {
			default: 25,
			max: 1000,
		},
		lean: true,
	};

	app.use('/helpdesk', service(options));
	const helpdeskService = app.service('/helpdesk');
	helpdeskService.hooks(hooks);
};
