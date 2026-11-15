# Поля как статические модели: владение и переиспользование

Обычное поле формы принадлежит форме. Его **описание** можно переиспользовать
в регистрации, восстановлении пароля и профиле, сохраняя отдельное состояние
каждого поля. Для этого подходит одно определение `staticModel` и дочерние
экземпляры через `children.one`/`children.many`.

`staticModel(...)` и `Model.static()` выполняют разные задачи:

| Операция | Граф юнитов | Состояние и lifetime |
| --- | --- | --- |
| `staticModel({ with, data, setup })` | Один на конкретное определение модели | Описание, ещё не экземпляр |
| `parent.email.create(...)` | Использует граф определения Email | Отдельный экземпляр; удаляется с родителем |
| `form.email.value = existingEmail` для `refs.one` | Использует существующий экземпляр | Ссылка; не становится владельцем |
| `Email.static(...)` | Создаёт новый независимый native-граф при каждом вызове | Модульная модель со значениями в scope приложения и отдельным lifetime |

Поэтому `.static()` не нужен для каждого поля формы. Он уместен, когда нужен
именно отдельный модульный граф, например для самостоятельного поля приложения.
Само нахождение вне формы не требует `.static()`: обычная корневая модель может
жить через `.create()`, а переиспользуемое дочернее поле — принадлежать общему
draft/редактору. В Core определение, используемое как ребёнок, создаётся через
родителя; для самостоятельного экземпляра такого определения `.static()` даёт
отдельный граф.

## Одно описание email, отдельные значения

В [исполняемом примере](examples/field-ownership.ts) `TextValue` объявляет данные
и изменение значения, `EmailRules` — правило почты, а `Email` объединяет traits:

```ts
const Email = staticModel({
  name: "Email",
  with: [TextValue, EmailRules],
});

const Signup = staticModel({
  name: "Signup",
  data: { email: children.one(Email) },
  onCreate(self) {
    // При загрузке DTO ребёнок уже может существовать.
    if (!self.email.value) self.email.create({});
  },
});

const Recovery = staticModel({
  name: "Recovery",
  data: { email: children.one(Email) },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
  },
});
```

В обоих местах передаётся одно и то же определение `Email`. Его `setup` и setups
его traits выполняются один раз. Каждое дочернее поле получает собственный scope
и lifetime:

```ts
const app = scope();
const [signup, recovery] = scoped(app, () => [Signup.create({}), Recovery.create({})]);
const signupEmail = signup.email.value!;
const recoveryEmail = recovery.email.value!;

await signupEmail.fill("ada@example.com");
signupEmail.state.value;   // "ada@example.com"
recoveryEmail.state.value; // ""

await signup.dispose();
signupEmail.alive;   // false
recoveryEmail.alive; // true
```

Один общий `.node` не означает общее значение: юнит читает данные текущего
экземпляра. Проверка примера создаёт 12 полей в двух типах форм и подтверждает
**ноль новых деклараций store/event/reaction при создании экземпляров**, а также
изоляцию значений, фокуса, ошибок и подписок. Это проверка устройства графа,
не результат сравнения производительности с полноценным `createField`.

Модель-ребёнок хранится в своей коллекции. Её ID должен различать экземпляры
в пределах модели и приложения. Не задавайте всем независимым email ID `"email"`:
опустите ID или задайте стабильный ключ с пространством имён формы и поля.

## Одно состояние email в нескольких формах

Если изменение email в одной форме должно сразу менять его в другой, нужен один
**экземпляр**. У него остаётся один владелец, например общий черновик; формы
содержат `refs.one(Email)`:

```ts
const SharedDraft = staticModel({
  name: "SharedDraft",
  data: { email: children.one(Email) },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
  },
});

const Editor = staticModel({
  name: "Editor",
  data: { email: refs.one(Email).policy("nullify") },
});

const [draft, first, second] = scoped(app, () => [
  SharedDraft.create({}), Editor.create({}), Editor.create({}),
]);
const sharedEmail = draft.email.value!;
first.email.value = sharedEmail;
second.email.value = sharedEmail;

await sharedEmail.fill("shared@example.com");
first.email.value!.state.value;  // "shared@example.com"
second.email.value!.state.value; // "shared@example.com"

await first.dispose();
sharedEmail.alive; // true: владелец — draft

await draft.dispose();
second.email.value; // null: цель удалена, policy = nullify
```

Обе формы видят ошибки, фокус и выполняющуюся работу одного поля. Операции над
общим экземпляром, включая reset/validate в полной реализации поля, действуют
на это общее состояние. Если формы должны независимо проверять или сбрасывать
email, им нужны разные дочерние экземпляры одного определения.

Ссылка не продлевает lifetime автоматически и не делает форму вторым владельцем.
Не стоит делать общую почту ребёнком первой из двух равноправных форм: её удаление
завершит жизнь поля. Общий draft должен жить столько, сколько нужно его редакторам.
Lifetime экземпляра и отмена конкретного вызова — разные вещи: вызов эффекта,
вложенный в отменяемую операцию формы, может наследовать сигнал этой операции.

Связи устанавливаются в одном приложении. Передача handle из другого scope
отклоняется; для другого SSR-запроса создаются собственные экземпляры с данными.

## Где использовать traits

Trait переиспользует данные и поведение: значение, фокус, валидацию, управление
ошибками. Он не является экземпляром и не определяет владельца поля.

Если обеим формам нужен одинаковый email, объявите `Email` один раз и используйте
его в обеих связях. Для разных правил можно объявить разные конкретные модели
с общими traits. В таком случае граф создаётся один раз **на каждое конкретное
определение**, а не один раз на trait для всех моделей.

Общие правила почты живут в `EmailRules`; проверки, зависящие от нескольких
полей конкретной формы, принадлежат форме. Переиспользуемый Email не должен
замыкаться на экземпляр Signup. Владение ребёнком не означает, что его scope
автоматически становится scope всех полей родителя: зависимости передаются
явно через связанные экземпляры или проверяются на уровне формы.

Данные экземпляра объявляются в `data`. Значение читается через `self` внутри
юнита; mutable-переменная в замыкании `setup` была бы общей для всех экземпляров.
`setup` описывает юниты и не читает будущего ребёнка через `self.email.value`.
Ребёнок создаётся через DTO или в синхронном `onCreate`, без объявления новых
юнитов в этом hook. Внешние ресурсы связываются с lifetime экземпляра через
эффекты и `onCleanup`.

Для SSR нужны стабильные имена/SID определений. `children` сериализуются в DTO
встроенно, `refs` — по ID. Пример проверяет `json()` вместе со scope snapshot:
восстановление значения и локального фокуса в другом приложении сохраняет общий
граф определения, но не связывает состояния двух приложений.

## Полноценные модели Forms

`@virentia/forms/models` предоставляет `fieldModel`, `arrayFieldModel` и `shapeFieldModel`: определения `staticModel` с traits
значения и валидации, полный Scalar Field API в свойстве `field`. Существующие
`createField`, `createForm`, стратегии, методы и adapters продолжают работать.
Опциональный импорт моделей нужен при объявлении таких полей; обычный импорт
Forms не загружает TypeBox.

```ts
import { scope, scoped } from "@virentia/core";
import { children, refs, staticModel } from "@virentia/core/models";
import { createForm } from "@virentia/forms";
import { fieldModel } from "@virentia/forms/models";

const Email = fieldModel("", {
  name: "FormEmail",
  validate: value => value.includes("@") ? null : "Invalid email",
});

const Signup = staticModel({
  name: "SignupWithEmail",
  data: { email: children.one(Email) },
  setup(self) {
    return { form: createForm({
      schema: () => ({ email: self.email.value!.field }),
    }) };
  },
  onCreate(self) {
    if (!self.email.value) self.email.create({});
  },
});

const signup = scoped(scope(), () => Signup.create({
  email: { value: "initial@example.com" },
}));
await signup.form.fill({ values: { email: "next@example.com" } });
signup.form.fields.email.state.value; // "next@example.com"
await signup.form.reset();
signup.form.values.value;             // { email: "initial@example.com" }
await signup.dispose();
```

`schema: () => ...` разрешает ссылки в scope экземпляра. Она объявляется в
`setup`, возвращает готовые поля или вложенные объекты с полями и может следовать
замене `refs`. Произвольные исходные значения используйте в обычной объектной
схеме; для модельной схемы объявляйте поля заранее. Один вызов `fieldModel` нужно
переиспользовать в `children` разных типов форм — повторный вызов фабрики создаёт
новое определение и новый граф.

Для намеренного общего состояния создайте ребёнка у общего draft, а в редакторах
используйте `refs.one(Email).policy("nullify")` и ту же функцию схемы:

```ts
const Editor = staticModel({
  data: { email: refs.one(Email).policy("nullify") },
  setup(self) {
    return { form: createForm({ schema: () => self.email.value
      ? { email: self.email.value.field }
      : {},
    }) };
  },
});
```

Удаление редактора не удаляет цель ссылки. Замена ссылки меняет `form.fields`
и отслеживаемые зависимости; старое поле перестаёт запускать change-валидацию.
Reset общего поля меняет его во всех редакторах. Snapshot каждой формы остаётся
её собственным: `persist`/submit могут обновить его независимо от другой формы.

Начальный snapshot снимается после загрузки DTO и синхронного `onCreate`, когда
дочерние поля уже существуют. Стабильные имена/SID модели позволяют scope snapshot
сохранить исходные значения, фокус, meta, ошибки и snapshot формы для hydration.
`json()` переносит DTO, а локальные свойства и исходные значения — scope snapshot;
при переносе только DTO полученное значение становится новым исходным.

В модельном `setup` встроенные Field/ArrayField/ShapeField помечаются как полные:
`normalizeField` возвращает их без повторных effects. Для обычных полей вне
модельного setup сохранён прежний путь нормализации: отдельный контроль короткого
dispatch не дал оснований безопасно переносить этот fast path в общий runtime. Собственные неполные `FieldContract` сначала нормализуйте
в `setup` через `normalizeField`; при необходимости оберните результат в
`defineField`, чтобы вернуть его как привязанный API. Не создавайте юниты во время
разрешения схемы или в `onCreate`.

## Связанные пакеты

### Wizard с дочерними полями

Объявляйте wizard и его шаги в том же `setup`, что и форму. Если поля приходят
из `children`/`refs`, используйте `createForm({ schema: () => ... })`, затем
`createWizard({ form, steps })`. `form.pick(...)`, объявленные здесь для шагов,
сохраняют ленивое разрешение схемы: они не читают ребёнка до его создания и не
создают новый граф при каждом экземпляре.

[Исполняемый пример](examples/model-wizard.ts) содержит Email и DisplayName как
дочерние `fieldModel`, одну корневую форму, два шага с проекциями и общий review:

```ts
import { scope, scoped, serialize } from "@virentia/core";
import { Signup } from "./examples/model-wizard";

const app = scope();
const signup = scoped(app, () => Signup.create({ id: "signup" }));
await signup.wizard.currentForm.value.fill({ values: { email: "ada@example.com" } });
await signup.wizard.next();
await signup.wizard.currentStep.value.form.fill({ values: { name: "Ada" } });
signup.wizard.form.values.value; // { email: "ada@example.com", name: "Ada" }

const dto = signup.json();
const snapshot = JSON.parse(JSON.stringify(serialize(app)));
const restored = scoped(scope({ snapshot }), () => Signup.create(dto));
await restored.wizard.goTo("review");
await restored.dispose();
await signup.dispose();
```

Для обычной заранее заданной схемы остаётся `createWizardForm({ schema, steps })`.
Оба wizard API возвращаются из `setup` напрямую. Их stores и методы, корневая
форма и формы внутри `steps`, `visibleSteps`, `currentStep`, `currentForm`
привязаны к экземпляру. Вызовы сохранённого `currentForm.value` продолжают
работать с выбранной формой шага; при переходе заново прочитайте `currentForm`,
чтобы получить форму нового шага. Для React достаточно
`useWizardForm(signup.wizard)`, а `view.currentForm` можно передать в `useForm`.

Wizard не становится вторым владельцем переданной формы или её полей. Если форма
заимствована у общего draft, удаление wizard не удаляет draft. `.static()` для
такого переиспользования не требуется. Встроенные формы привязываются
автоматически; пользовательские form contracts без модельных метаданных
сохраняют свой существующий контракт работы со scope.

DTO восстанавливает данные дочерних моделей, а scope snapshot со стабильными
именами/SID сохраняет локальные исходные значения и snapshot формы. Навигация
wizard хранится в анонимных runtime stores: нужный шаг восстанавливается явно
через `goTo` после загрузки полей. Сам `goTo` сохраняет обычную проверку шагов;
невалидные промежуточные шаги могут блокировать переход.

### Scopes и lifecycle адаптеров

Native Forms, wizard, net query/mutation, route/router и routerControls, возвращённые из
`setup`, привязывают вложенные units и методы к экземпляру. Пример: `row.load.data`,
`row.load.pending`, `row.page.params`, `row.navigation.path`, `row.form.fields.email`.
Обычные пользовательские объекты из `setup` автоматически не преобразуются.
У effect-членов модели `pending`, `inFlight`, lifecycle-события и `abort`
привязаны к экземпляру. Отмена одного вызова не затрагивает соседний экземпляр;
производные bound-события `map/filter/filterMap` освобождаются с моделью.

React/Vue subscriptions и Forms React hooks учитывают scope привязанного store,
в том числе дочернего поля. Storage `persist({ source: child.value, ... })` также
использует scope этого store; binding принадлежит контексту, где вызван `persist`.
Вызывайте его в bound-методе, effect или `onCreate`, чтобы он завершался с моделью.
История model-owned router автоматически отсоединяется при disposal экземпляра.
Query trackers объявляйте в том же `setup` и возвращайте как `{ tracker }`, чтобы
их `enter`/`exit` и события тоже были привязаны к экземпляру.

`ctx.read(other.field.state)` сохраняет зависимость от scope другого ребёнка.
Настройки приложения, объявленные вне модели, читаются из scope приложения;
изменение настройки перепроверяет поля этого приложения. Валидатор продолжает
выполняться в своём исходном scope, включая async effects и handler overrides.

Для Effector создавайте `formToEffector(instance.form)` после создания модели,
связав корневой scope приложения через `associate`. Один fork может обслуживать
несколько независимых модельных форм. При замене `refs` новое обращение к
`view.fields.email` выбирает новое поле; сохранённый ранее lens остаётся handle
прежнего поля. Дочерний scope не требует отдельной ассоциации.

## Совместимость с native-коллекциями

Для D определений и N полей структура общего графа — O(D · U) деклараций юнитов
и O(N) экземпляров с данными; U — размер графа определения. Создание экземпляров
полной модельной формы не объявляет новых stores/events/reactions. В owned-связях,
индексах, scoped-зависимостях и фасадах всё равно есть работа; первое чтение
проверяется отдельно от конструктора.

Самостоятельные маленькие формы могут продолжать использовать `createField` и
объектную схему. Owned scalar-модели предназначены для повторяющихся моделей и
явного lifetime; их стоимость сравнивается с такой же модельной семантикой.
Отдельные native-графы и модельные handles имеют разные расходы на доступ.
Для встроенных `Field` и `fieldModel` коллекции `ArrayField.items`,
`itemFields`/`fields` и `ShapeField.fields` возвращают handles в scope модели.
Это относится и к элементам, добавленным позднее. Начальное
получение этих handles не объявляет новые units; computed коллекции общий для
определения, а его результат кешируется отдельно в каждом экземпляре.
Пользовательские поля сохраняют свою identity, прототип и дополнительные методы;
их собственный контекст определяется фабрикой, как и в обычных коллекциях.

Для динамических scalar-элементов можно использовать существующий `createItem`
вместе с одним `fieldModel` и `children.many`, без `.static()`:

```ts
const Phone = fieldModel("");
const Draft = staticModel({
  data: { phones: children.many(Phone) },
  setup(self) {
    return { list: createArrayField<string>([], {
      createItem: value => self.phones.add({ value }).field,
    }) };
  },
});
const draft = scoped(app, () => Draft.create({}));
await draft.list.push("123");
await draft.list.items.value[0].fill("456");
```

Здесь владелец поля — `Draft`; `list` хранит состав отображаемых полей. `remove`
и `clear` коллекции не удаляют модель поля: тот же экземпляр может использоваться
другой формой. Если поле больше не нужно, сначала удалите его из представлений,
затем вызовите `draft.phones.remove(phone)`. Disposal черновика удаляет его детей.
Передача уже существующего `phone.field` в `push`/`add` не переносит владение.

Для SSR храните данные и связи в `data` и восстанавливайте состав представления
из DTO/связей. Анонимный setup-store с массивом field-объектов не является
сериализуемым DTO. Для сериализуемого состава и владения используйте
`arrayFieldModel`/`shapeFieldModel`, описанные ниже.

Проверки адаптации находятся в `packages/forms/tests/field-models.test.ts`,
а полный сценарий router → net → формы → storage → React/Vue/Effector — в
`virentia/ecosystem/tests/interoperability.test.ts`. Воспроизводимый контроль фаз
для native-форм и общей/динамической модельной реализации —
`experiments/model-fields`.

## Все виды полей как модели

Новый код использует определения полей вместо создания field-объектов при каждом
добавлении элемента. [Исполняемый пример всех полей](examples/all-fields.ts)
содержит скаляр, массив, shape, массив shape-полей и расширение `fieldType`.

```ts
import { children, staticModel } from "@virentia/core/models";
import { createForm } from "@virentia/forms";
import { arrayFieldModel, fieldModel, shapeFieldModel } from "@virentia/forms/models";

const Email = fieldModel("", { name: "Email" });
const Phone = fieldModel("", { name: "Phone" });
const Phones = arrayFieldModel([""], { item: Phone, name: "Phones" });
const Contact = shapeFieldModel({ email: Email, phones: Phones, label: "" }, { name: "Contact" });
const Contacts = arrayFieldModel([], { item: Contact, name: "Contacts" });

const Profile = staticModel({
  data: { contacts: children.one(Contacts) },
  setup(self) {
    return { form: createForm({ schema: () => ({ contacts: self.contacts.value!.field }) }) };
  },
  onCreate(self) { if (!self.contacts.value) self.contacts.create({}); },
});
```

`arrayFieldModel(initial, { item })` переиспользует переданное определение для
каждого элемента. Если `item` опущен, создаётся одно общее определение скалярного
элемента. `shapeFieldModel({ key: Definition, ... })` создаёт детей указанных
определений; обычные начальные значения (`label: ""`, `count: 0`) также получают
собственные модельные определения. Новые ключи при `fill` используют заранее
объявленную `additional` модель или стандартный скалярный вариант.

Публичные операции остаются у `.field`: `fill`, `reset`, `push`, `insert`,
`move`, `swap`, `remove`, `clear`, `add`, `replace`, validation и errors.
Состав коллекции меняется этими методами, `.value` модели служит производным
readonly-store. Для дочерних полей доступны `field.items.value` и
`field.fields.value`. Новых юнитов на экземпляр или при создании элементов не
объявляется: граф каждого определения уже существует.

### Владение коллекцией и общие поля

Созданный из значения элемент принадлежит модели коллекции. Удаление элемента,
усечение через `fill`, замена или `clear` завершают жизнь удалённых детей.
Операция ожидает их асинхронное disposal. `reset` восстанавливает начальный
состав, при необходимости создавая свежие экземпляры удалённых начальных детей.
Сохранённые handles удалённых полей остаются недействительными.

Переданный существующий `field` привязывается как `refs`, с политикой nullify.
Его определение должно быть объявлено через `item`, в shape-схеме либо через
`additional`. Массив может несколько раз ссылаться на один экземпляр: удаление
одного вхождения сохраняет остальные. Удаление коллекции не удаляет заимствованное
поле. При удалении настоящего владельца ссылки исчезают из представления. Поля
из другого application scope отклоняются.

Для общего email создайте его ребёнком общего draft и передавайте
`draft.email.value!.field` в нужные коллекции. Определение, используемое как
ребёнок, создаётся через владеющую relation; не используйте самостоятельное
`Email.create()` для обхода этого владения. `.static()` остаётся отдельным
модульным графом и для такого переиспользования не требуется.

### Расширенные поля

Передайте существующий `fieldType` через `fieldModel(initial, { create })`.
Фабрика выполняется в shared setup и должна использовать `createField`/свой
`base`, чтобы значение, meta, ошибки, фокус и reset оставались в trait cells
модели. Дополнительные методы и их типы сохраняются. Не вызывайте `fieldModel`
внутри `createItem`: само определение объявляется один раз, создаются его дети.

Начальное значение, meta и error, заданные внутри конструктора фабрики, становятся
defaults и восстанавливаются при reset. Явный `value` DTO имеет приоритет;
scope snapshot сохраняет свои метаданные и исходный baseline. `create` выполняется
на этапе объявления графа, а не при каждом `.create(dto)`/`fill`: нормализация
нового ввода задаётся методами поля или преобразованием входа модели.

При перекрывающихся изменениях Array/Shape уже начатое удаление ребёнка не
запускается повторно. Операция ожидает собственный cleanup, а reset сначала
дожидается незавершённых удалений, затем восстанавливает исходный состав.

### DTO и hydration

`json()` модельных Array/Shape сохраняет состав, порядок, принадлежащих им детей
и ссылки. Загрузите полученный DTO в ту же модель через `.create(dto)`. Для
сохранения исходного reset-состояния, meta и ошибок используйте также scope
snapshot и стабильные имена/SID. Корневым экземплярам для hydration задавайте
явные стабильные `id`, особенно если в приложении несколько корней одного
определения. Заимствованные цели загружаются со своим
владельцем в том же приложении; ссылки на них разрешаются после его загрузки.

Старые `createArrayField`/`createShapeField` сохраняют прежнее поведение:
нахождение field-объекта в такой коллекции само по себе не переносит владение
и не превращает анонимный runtime-store в DTO. Это путь совместимости; для
новых модельных форм предпочтительны описанные выше определения.
