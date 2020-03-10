const assert = require('assert');
const chai = require('chai');

const { expect } = chai;

const app = require('../../../src/app');
const { equal: equalIds } = require('../../../src/helper/compare').ObjectId;

const {
	schoolModel: School,
	yearModel: YearModel,
} = require('../../../src/services/school/model');

const testObjects = require('../helpers/testObjects')(app);
const { create: createSchool, info: createdSchoolIds } = require('./../helpers/services/schools')(app);


describe('school service', () => {
	it('registered the schools services', () => {
		assert.ok(app.service('schools'));
	});

	describe('create school with or without year', () => {
		let defaultYears = null;
		let sampleYear;
		let sampleSchoolData;
		const schoolService = app.service('/schools');

		before('load data and set samples', async () => {
			defaultYears = await YearModel.find().lean().exec();
			sampleYear = defaultYears[0];
			const school = await createSchool();
			sampleSchoolData = await School.findById(school._id).lean().exec();
			delete sampleSchoolData._id;
		});

		it('create school with currentYear defined explictly', async () => {
			const serviceCreatedSchool = await schoolService.create(
				Object.assign({}, sampleSchoolData, { currentYear: sampleYear }),
			);
			const { _id: schoolId } = serviceCreatedSchool;
			createdSchoolIds.push(schoolId);
			const out = await schoolService.get(schoolId);
			expect(out, 'school has been saved').to.be.not.null;
			expect(out.currentYear, 'the defined year has been added to the school').to.be.ok;
			expect(equalIds(sampleYear._id, out.currentYear),
				'the defined year has been added to the school').to.be.true;
		});

		it('create school with no currentYear defined that will be added', async () => {
			const serviceCreatedSchool = await schoolService.create(sampleSchoolData);
			const { _id: schoolId } = serviceCreatedSchool;
			createdSchoolIds.push(schoolId);
			const out = await schoolService.get(schoolId);
			expect(out, 'school has been saved').to.be.not.null;
			const { currentYear } = out;
			expect(currentYear, 'the defined year has been added to the school').to.be.ok;
			const foundYear = defaultYears.filter((year) => equalIds(year._id, currentYear));
			expect(foundYear.length, 'the auto added year exists in years').to.be.equal(1);
			// here we could test, we have defaultYear added but however we just need any year
			// to be set and this should not test year logic
		});
	});

	describe('patch schools', () => {
		it('administrator can patch his own school', async () => {
			const school = await testObjects.createTestSchool({});
			const admin = await testObjects.createTestUser({
				schoolId: school._id,
				roles: ['administrator'],
			});
			const params = await testObjects.generateRequestParamsFromUser(admin);

			const result = await app.service('/schools').patch(school._id, { features: ['rocketChat'] }, params);
			expect(result).to.not.be.undefined;
			expect(result.features).to.include('rocketChat');
		});

		it('administrator can not patch a different school', async () => {
			const usersSchool = await testObjects.createTestSchool({});
			const otherSchool = await testObjects.createTestSchool({});
			const admin = await testObjects.createTestUser({
				schoolId: usersSchool._id,
				roles: ['administrator'],
			});
			const params = await testObjects.generateRequestParamsFromUser(admin);

			try {
				await app.service('/schools').patch(
					otherSchool._id, { features: ['rocketChat'] }, params,
				);
				throw new Error('should have failed');
			} catch (err) {
				expect(err.message).to.not.equal('should have failed');
				expect(err.code).to.equal(403);
			}
		});

		it('superhero can patch any school', async () => {
			const usersSchool = await testObjects.createTestSchool({});
			const otherSchool = await testObjects.createTestSchool({});
			const batman = await testObjects.createTestUser({
				schoolId: usersSchool._id,
				roles: ['superhero'],
			});
			const params = await testObjects.generateRequestParamsFromUser(batman);

			const result = await app.service('/schools').patch(
				otherSchool._id, { name: 'all strings are better with "BATMAN!" in it!' }, params,
			);
			expect(result).to.not.be.undefined;
			expect(result.name).to.equal('all strings are better with "BATMAN!" in it!');
		});
	});

	after(testObjects.cleanup);
});

describe('years service', () => {
	it('registered the years services', () => {
		assert.ok(app.service('years'));
		assert.ok(app.service('gradeLevels'));
	});
});
