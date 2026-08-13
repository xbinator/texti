/**
 * @file widget-bindings.test.ts
 * @description 验证 BWidget 模板绑定根作用域解析。
 */
import type { WidgetRenderContext } from 'types/widget';
import { describe, expect, it } from 'vitest';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import { evaluateWidgetBindingExpression, resolveWidgetSmartValue, resolveWidgetTemplateFieldText, resolveWidgetTemplateValue } from '@/components/BWidget/utils/widgetBindings';

/** 已移除的旧根变量名。 */
const REMOVED_LEGACY_ROOT = ['last', 'Result'].join('');

/**
 * 创建测试渲染上下文。
 * @returns 渲染上下文
 */
function createRenderContext(): WidgetRenderContext {
  return {
    input: {
      city: '上海'
    },
    output: {
      condition: '晴'
    },
    data: {
      weather: {
        temperature: 28
      }
    }
  };
}

describe('widgetBindings', (): void => {
  it('resolves structured Smart values without template syntax', (): void => {
    const context = createRenderContext();
    const runtimeOptions = {
      renderContext: context,
      renderOptions: { mode: 'runtime' as const }
    };

    expect(resolveWidgetSmartValue(createLiteralValue(false), runtimeOptions)).toBe(false);
    expect(resolveWidgetSmartValue(createVariableValue('$input.city'), runtimeOptions)).toBe('上海');
    expect(
      resolveWidgetSmartValue(createVariableValue('$input.city'), {
        renderContext: context,
        renderOptions: { mode: 'design' }
      })
    ).toBeUndefined();
    expect(resolveWidgetSmartValue(createVariableValue('$input.missing'), runtimeOptions)).toBeUndefined();
    expect(resolveWidgetSmartValue('{{ $input.city }}' as unknown as BSmartValue<string>, runtimeOptions)).toBeUndefined();
  });

  it('resolves field text from the content visible in each render mode', (): void => {
    const context = createRenderContext();
    const metadata = {
      content: "评分：{{ weather.temperature }} / {{ movie.hasScore ? movie.scoreText : '暂无' }}"
    };

    expect(
      resolveWidgetTemplateFieldText(metadata, 'content', {
        renderContext: context,
        renderOptions: { mode: 'design' }
      })
    ).toBe('评分： / ');
    expect(
      resolveWidgetTemplateFieldText({ content: '{{ weather.temperature }}' }, 'content', {
        renderContext: context,
        renderOptions: { mode: 'runtime' }
      })
    ).toBe('28');
  });

  it('resolves data fields directly without the data root', (): void => {
    const context = createRenderContext();

    expect(evaluateWidgetBindingExpression('weather.temperature', context)).toEqual({
      resolved: true,
      value: 28
    });
    expect(resolveWidgetTemplateValue('{{ $input.city }} 当前 {{ weather.temperature }}°C', context)).toBe('上海 当前 28°C');
    expect(resolveWidgetTemplateValue('{{ $output.condition }}', context)).toBe('晴');
  });

  it('resolves safe conditional expressions in widget templates', (): void => {
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: {
        movie: {
          hasScore: true,
          scoreText: '8.6'
        }
      }
    };
    const template = "{{ movie.hasScore ? movie.scoreText : '暂无' }}";

    expect(resolveWidgetTemplateValue(template, context)).toBe('8.6');

    context.data.movie = {
      hasScore: false,
      scoreText: '8.6'
    };
    expect(resolveWidgetTemplateValue(template, context)).toBe('暂无');
  });

  it('resolves expressions from input, output and loop-local roots', (): void => {
    const context: WidgetRenderContext = {
      input: {
        taxRate: 0.1
      },
      output: {
        discount: 2
      },
      data: {}
    };

    expect(
      resolveWidgetTemplateValue('{{ item.price * quantity + $input.taxRate - $output.discount }}', context, {
        locals: {
          item: { price: 10 },
          quantity: 2
        }
      })
    ).toBe(18.1);
  });

  it('blocks global root names even when widget data defines them', (): void => {
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: {
        window: { location: '不可见' },
        document: { title: '不可见' },
        globalThis: { value: '不可见' },
        process: { env: '不可见' }
      }
    };

    ['window.location', 'document.title', 'globalThis.value', 'process.env'].forEach((expression: string): void => {
      expect(evaluateWidgetBindingExpression(expression, context), expression).toEqual({
        resolved: false,
        value: undefined
      });
    });
  });

  it('resolves direct data fields whose names start with input', (): void => {
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: {
        inputText: '继续',
        inputValue: {
          label: '确认'
        }
      }
    };

    expect(evaluateWidgetBindingExpression('inputText', context)).toEqual({
      resolved: true,
      value: '继续'
    });
    expect(resolveWidgetTemplateValue('{{ inputValue.label }}', context)).toBe('确认');
  });

  it('does not treat data as a binding root', (): void => {
    const context = createRenderContext();
    const template = '{{ data.weather.temperature }}';

    expect(evaluateWidgetBindingExpression('data.weather.temperature', context)).toEqual({
      resolved: false,
      value: undefined
    });
    expect(resolveWidgetTemplateValue(template, context)).toBe(template);
  });

  it('does not resolve removed legacy binding root', (): void => {
    const context = {
      ...createRenderContext(),
      [REMOVED_LEGACY_ROOT]: {
        status: 'success'
      }
    } as unknown as WidgetRenderContext;
    const expression = `${REMOVED_LEGACY_ROOT}.status`;
    const template = `{{ ${expression} }}`;

    expect(evaluateWidgetBindingExpression(expression, context)).toEqual({
      resolved: false,
      value: undefined
    });
    expect(resolveWidgetTemplateValue(template, context)).toBe(template);
  });

  it('does not resolve removed output binding root', (): void => {
    const context = {
      ...createRenderContext(),
      output: {
        condition: '晴'
      }
    } as unknown as WidgetRenderContext;
    const expression = 'output.condition';
    const template = `{{ ${expression} }}`;

    expect(evaluateWidgetBindingExpression(expression, context)).toEqual({
      resolved: false,
      value: undefined
    });
    expect(resolveWidgetTemplateValue(template, context)).toBe(template);
  });

  it('resolves loop local variables before data fields', (): void => {
    const context: WidgetRenderContext = {
      input: {
        city: '上海'
      },
      output: undefined,
      data: {
        item: {
          name: 'data item'
        },
        weather: {
          temperature: 28
        }
      }
    };

    expect(evaluateWidgetBindingExpression('item.name', context, { locals: { item: { name: '拿铁' }, index: 2 } })).toEqual({
      resolved: true,
      value: '拿铁'
    });
    expect(
      resolveWidgetTemplateValue('{{ item.name }} #{{ index }} {{ weather.temperature }}', context, {
        locals: { item: { name: '拿铁' }, index: 2 }
      })
    ).toBe('拿铁 #2 28');
  });

  it('resolves custom loop local variable names', (): void => {
    const context = createRenderContext();

    expect(
      resolveWidgetTemplateValue('{{ record.name }} #{{ rowIndex }}', context, {
        locals: { record: { name: '美式' }, rowIndex: 4 }
      })
    ).toBe('美式 #4');
  });

  it('does not read getters while formatting mixed object bindings', (): void => {
    let getterCalls = 0;
    const payload: Record<string, unknown> = {
      safe: '保留'
    };
    Object.defineProperty(payload, 'secret', {
      enumerable: true,
      get: (): string => {
        getterCalls += 1;
        return '不应读取';
      }
    });
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: { payload }
    };

    const resolvedValue = resolveWidgetTemplateValue('结果：{{ payload }}', context);

    expect(getterCalls).toBe(0);
    expect(resolvedValue).toBe('结果：{\n  "safe": "保留"\n}');
  });

  it('does not call toJSON while formatting mixed object bindings', (): void => {
    let toJsonCalls = 0;
    const payload = {
      safe: '保留',
      toJSON: (): Record<string, string> => {
        toJsonCalls += 1;
        return { unsafe: '不应执行' };
      }
    };
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: { payload }
    };

    const resolvedValue = resolveWidgetTemplateValue('结果：{{ payload }}', context);

    expect(toJsonCalls).toBe(0);
    expect(resolvedValue).toBe('结果：{\n  "safe": "保留"\n}');
  });

  it('preserves bigint and circular markers in safely formatted objects', (): void => {
    const payload: Record<string, unknown> = {
      count: 2n
    };
    payload.self = payload;
    const context: WidgetRenderContext = {
      ...createRenderContext(),
      data: { payload }
    };

    expect(resolveWidgetTemplateValue('结果：{{ payload }}', context)).toBe('结果：{\n  "count": "2",\n  "self": "[Circular]"\n}');
  });

  it('keeps current input and data binding behavior without locals', (): void => {
    const context = createRenderContext();

    expect(resolveWidgetTemplateValue('{{ $input.city }} 当前 {{ weather.temperature }}°C', context)).toBe('上海 当前 28°C');
    expect(resolveWidgetTemplateValue('{{ item.name }}', context)).toBe('{{ item.name }}');
  });
});
