const { authenticate } = require('@feathersjs/authentication');
const { BadRequest } = require('@feathersjs/errors');
const { disallow, iff, isProvider } = require('feathers-hooks-common');

const base64regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
const isBase64 = async (context) => {
	const { data } = context.data;

	if (!data && base64regex.test(data)) {
		throw new BadRequest('The key "data" is not base64 encoded.');
	}

	return context;
};

exports.before = {
	all: [authenticate('jwt')],
	find: [iff(isProvider('external'), disallow())],
	get: [], // no scope restiction is needed
	create: [
		iff(isProvider('external'), disallow()),
		isBase64,
	],
	update: [disallow()],
	patch: [
		iff(isProvider('external'), disallow()),
		isBase64,
	],
	remove: [iff(isProvider('external'), disallow())],
};

exports.after = {
	all: [],
	find: [],
	get: [],
	create: [],
	update: [],
	patch: [],
	remove: [],
};