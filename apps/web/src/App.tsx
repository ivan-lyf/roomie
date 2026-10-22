import { Redirect, Route, Switch } from 'wouter';
import { CatalogPage } from './pages/CatalogPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { PlansPage } from './pages/PlansPage';

export function App() {
  return (
    <Switch>
      <Route path="/" component={PlansPage} />
      <Route path="/catalog" component={CatalogPage} />
      <Route path="/plans/:id/edit">{({ id }) => <EditorPage id={id} />}</Route>
      <Route path="/plans/:id/3d">{({ id }) => <HomePage id={id} />}</Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}
