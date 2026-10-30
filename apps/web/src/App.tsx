import { Redirect, Route, Switch } from 'wouter';
import { CatalogPage } from './pages/CatalogPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { ListPage } from './pages/ListPage';
import { PlansPage } from './pages/PlansPage';
import { RatePage } from './pages/RatePage';

export function App() {
  return (
    <Switch>
      <Route path="/" component={PlansPage} />
      <Route path="/catalog" component={CatalogPage} />
      <Route path="/admin/rate" component={RatePage} />
      <Route path="/plans/:id/edit">{({ id }) => <EditorPage id={id} />}</Route>
      <Route path="/plans/:id/3d">{({ id }) => <HomePage id={id} />}</Route>
      <Route path="/plans/:id/list">{({ id }) => <ListPage id={id} />}</Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}
