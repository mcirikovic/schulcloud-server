const REQUEST_TIMEOUT = 8000; // ms
const request = require('request-promise-native');
const {Configuration} = require('@schul-cloud/commons');
const {GeneralError} = require('@feathersjs/errors');
const logger = require('../../../logger');
const EduSearchResponse = require('./EduSearchResponse');

const RETRY_ERROR_CODES = [401, 403];
const COOKIE_RENEWAL_PERIOD_MS = 1800000; // 30 min

const ES_ENDPOINTS = {
	AUTH:`${Configuration.get('ES_DOMAIN')}/edu-sharing/rest/authentication/v1/validateSession`,
	NODE: `${Configuration.get('ES_DOMAIN')}/edu-sharing/rest/node/v1/nodes/mv-repo.schul-cloud.org/`,
	SEARCH: `${Configuration.get('ES_DOMAIN')}/edu-sharing/rest/search/v1/queriesV2/mv-repo.schul-cloud.org/mds/ngsearch/`,
	TOKEN: `${Configuration.get('ES_DOMAIN')}/edu-sharing/oauth2/token`,
};

let lastCookieRenewalTime = null;


class EduSharingAuth {
	constructor() {
		if (EduSharingAuth.instance) {
			return EduSharingAuth.instance;
		}

		this.eduSharingCookie = null; /* JSESSION COOKIE */

		EduSharingAuth.instance = this;

	}

	basicAuthorizationHeaders() {
		return {
			Accept: 'application/json',
			'Content-type': 'application/json',
			Authorization: `Basic ${
				Buffer.from(`${Configuration.get('ES_USER')}:${Configuration.get('ES_PASSWORD')}`)
					.toString('base64')
			}`,
		};
	}

	cookieHeaders() {
		return {
			Accept: 'application/json',
			'Content-type': 'application/json',
			cookie: this.eduSharingCookie,
		}
	}

	async authorize() {
		logger.info('Renewal of Edusharing credentials');
		this.eduSharingCookie = await this.getCookie();
	}

	/**
	 * @returns {boolean}
	 */
	shouldAuthorize() {
		const now = new Date();
		const nextCookieRenewalTime = lastCookieRenewalTime
			? new Date(lastCookieRenewalTime.getTime() + COOKIE_RENEWAL_PERIOD_MS)
			: now;
		// should relogin if cookie expired or cookie or access token is empty
		const shouldRelogin = now >= nextCookieRenewalTime;

		if (shouldRelogin) {
			lastCookieRenewalTime = now;
		}

		return shouldRelogin;
	}

	// gets cookie (JSESSION) and attach it to header
	async getCookie() {
		const options = {
			uri: ES_ENDPOINTS.AUTH,
			method: 'GET',
			headers: this.basicAuthorizationHeaders,
			resolveWithFullResponse: true,
			json: true,
		};

		try {
			const result = await request(options);
			if (result.statusCode !== 200 || result.body.isValidLogin !== true) {
				throw Error('authentication error with edu sharing');
			}
			return result.headers['set-cookie'][0];
		} catch (e) {
			logger.error(`Couldn't get edusharing cookie: ${err.statusCode} ${err.message}`);
		}
	}

}


class EduSharingConnector {
	constructor() {
		if (EduSharingConnector.instance) {
			return EduSharingConnector.instance;
		}

		this.auth = new EduSharingAuth();


		EduSharingConnector.instance = this;
	}

	async eduSharingRequest(options) {
		if (this.auth.shouldAuthorize()) {
			await this.auth.authorize();
		}

		const maxConnectionAttempts = 3;
		const sleepMilliseconds = 500;
		let connectionAttempt = 0;
		const errors = [];

		do {
			try {
				const response = await request(options);
				return response;
			} catch (e) {
				if (RETRY_ERROR_CODES.indexOf(e.statusCode) !== -1) {
					// TODO this fallback should not be needed
					logger.info(`Trying to renew Edu-Sharing authorization. Attempt ${connectionAttempt}`);
					await this.auth.authorize();
				} else if (e.statusCode === 404) {
					return null;
				} else {
					//logger.error(`Edu-Sharing Request failed with error ${e.statusCode} ${e.message}`, options);
					throw new GeneralError('Edu-Sharing Request failed', options);
				}
			}

			// sleep for a bit, so that we don't kill the server
			await new Promise(resolve => setTimeout(resolve, sleepMilliseconds));

			connectionAttempt += 1;
		} while (connectionAttempt < maxConnectionAttempts);

		throw new GeneralError('Edu-Sharing Request failed', errors);
	}

	async getImage(url) {
		const options = {
			uri: url,
			method: 'GET',
			headers: {
				cookie: this.auth.eduSharingCookie,
			},
			// necessary to get the image as binary value
			encoding: null,
			resolveWithFullResponse: true,
			// edu-sharing returns 302 to error pages (e.g. 403, no-permissions.svc) having wrong status codes
			followRedirect: false, // errors 302 redirects to error pages
		};

		try {
			let result = await this.eduSharingRequest(options);
			const encodedData = `data:image;base64,${result.body.toString('base64')}`;
			return Promise.resolve(encodedData);
		}
		catch(err)  {
			logger.error(
				`Failed fetching image ${url} 
				${err.statusCode} ${err.message}`
			);
			return Promise.reject(err);
		}
	}

	async GET(id) {
		const propertyFilter = '-all-';

		const options = {
			method: 'GET',
			// eslint-disable-next-line max-len
			url: `${ES_ENDPOINTS.NODE}${id}/metadata?propertyFilter=${propertyFilter}`,
			headers: this.auth.cookieHeaders(),
			timeout: REQUEST_TIMEOUT,
		};

		const response = await this.eduSharingRequest(options);
		const parsed = JSON.parse(response);
		const { node } = parsed;
		if (node && node.preview && node.preview.url) {
			// eslint-disable-next-line max-len
			node.preview.url = await this.getImage(`${node.preview.url}&crop=true&maxWidth=1200&maxHeight=800`);
		}
		return node;
	}

	async FIND({
		query: {
			searchQuery = '',
			contentType = 'FILES',
			$skip,
			$limit,
			sortProperties = 'score',
		},
	}) {
		const skipCount = parseInt($skip, 10) || 0;
		const maxItems = parseInt($limit, 10) || 9;
		const sortAscending = false;
		const propertyFilter = '-all-'; // '-all-' for all properties OR ccm-stuff
		if (searchQuery.trim().length < 2) {
			return new EduSearchResponse();
		}

		const url = `${ES_ENDPOINTS.SEARCH}?`
			+ [
				`contentType=${contentType}`,
				`skipCount=${skipCount}`,
				`maxItems=${maxItems}`,
				`sortProperties=${sortProperties}`,
				`sortAscending=${sortAscending}`,
				`propertyFilter=${propertyFilter}`,
			].join('&');

		const options = {
			method: 'POST',
			// This will be changed later with a qs where sorting, filtering etc is present.
			// eslint-disable-next-line max-len
			url,
			headers: this.auth.cookieHeaders(),
			body: JSON.stringify({
				criterias: [
					{property: 'ngsearchword', values: [searchQuery.toLowerCase()]},
				],
				facettes: ['cclom:general_keyword'],
			}),
			timeout: REQUEST_TIMEOUT,
		};

		const response = await this.eduSharingRequest(options);
		const parsed = JSON.parse(response);
		if (parsed && parsed.nodes) {
			const promises = parsed.nodes.map(async (node) => {
				if (node.preview && node.preview.url) {
					node.preview.url = await this.getImage(`${node.preview.url}&crop=true&maxWidth=300&maxHeight=300`);
				}
			});
			await Promise.allSettled(promises);
		} else {
			return new EduSearchResponse();
		}

		return new EduSearchResponse(parsed);
	}

	static get Instance() {
		if (!EduSharingConnector.instance) {
			return new EduSharingConnector();
		}
		return EduSharingConnector.instance;
	}
}

module.exports = EduSharingConnector.Instance;
