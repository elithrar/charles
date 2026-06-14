import { describe, expect, it } from 'vitest';
import { buildPartsSearchPlan } from '../src/tools/parts-search.ts';

describe('parts search tool planning', () => {
  it('builds a Porsche 911 availability plan with vendor and forum targets', () => {
    const plan = buildPartsSearchPlan(
      'Confirm the part number and price for a 1988 Porsche 911 Carrera 3.2 injector harness. Check Pelican Parts, FCP Euro, and RockAuto.',
    );

    expect(plan).toMatchObject({
      requestType: 'availability-check',
      vehicle: 'air-cooled-911',
      years: ['1988'],
    });
    expect(plan.focus).toContain('1984-1989 Carrera 3.2 Motronic');
    expect(plan.sourceTargets.map((source) => source.name)).toEqual(
      expect.arrayContaining([
        'Pelican Parts catalog',
        'FCP Euro catalog',
        'RockAuto catalog',
        'Pelican 911 Technical Forum',
      ]),
    );
    expect(plan.responseContract.join(' ')).toContain('Lead with the answer');
  });

  it('builds a BMW 2002 plan with BluntTech, RockAuto, FAQ, and RealOEM targets', () => {
    const plan = buildPartsSearchPlan(
      'What parts are needed to solve a charging problem on my 1970 BMW 2002?',
    );

    expect(plan).toMatchObject({
      requestType: 'diagnose-parts-needed',
      vehicle: 'bmw-2002',
      years: ['1970'],
    });
    expect(plan.focus).toContain('1970 2002');
    expect(plan.sourceTargets.map((source) => source.name)).toEqual(
      expect.arrayContaining([
        'BluntTech catalog',
        'FCP Euro catalog',
        'RockAuto catalog',
        'BMW2002FAQ forum',
        'RealOEM BMW diagrams',
      ]),
    );
    expect(plan.verificationChecklist.join(' ')).toContain('avoid parts-cannon answers');
  });
});
